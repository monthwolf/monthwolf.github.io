import Vue from 'vue'
import { enableBot, disableBot } from 'tim'
import TIM from '@/sdk'

const gamePrototype = {
  currentTab: 'group', // 当前打开的 tab，默认是群信息 tab
  botEnabled: false, // 是否打开骰子开关
  logEnabled: false, // 是否打开日志记录开关
  logs: [], // id\from\nick\time\content 不记录全部的 tim msg 属性
  bgm: {}, // platform\type\id 平台、类型（单曲、专辑）、歌曲 id
  notes: [], // id\type\payload 主持人笔记
  noteUnread: false, // 是否有未读的笔记
  cards: {}, // 人物卡。 userID => 人物卡信息
  openedCards: ['group', 'note', 'log'], // 当前打开的所有 tab ['group', 'note', 'log', 群员ID]
  scene: '' // 当前游戏场景图片
}

const _ = (groupId) => {
  if (!game.state.list[groupId]) {
    Vue.set(game.state.list, groupId, JSON.parse(JSON.stringify(gamePrototype)))
  }
  return game.state.list[groupId]
}

const save = (key, groupId, content) => {
  localStorage.setItem(`paotuan${key}-${groupId}`, JSON.stringify(content))
}

const getInitialSavedContent = (key, groupId) => {
  const saved = localStorage.getItem(`paotuan${key}-${groupId}`)
  return saved ? JSON.parse(saved) : []
}

const game = {
  state: {
    list: {} // groupId => game
  },
  mutations: {
    initGame(state, groupId) {
      Vue.set(state.list, groupId, JSON.parse(JSON.stringify(gamePrototype)))
      state.list[groupId].notes = getInitialSavedContent('note', groupId)
      state.list[groupId].logs = getInitialSavedContent('log', groupId)
      state.list[groupId].cards = getInitialSavedContent('card', groupId)
    },
    toggleBotEnabled(state, { groupId, enabled }) {
      _(groupId).botEnabled = enabled
    },
    toggleLogEnabled(state, { groupId, enabled }) {
      _(groupId).logEnabled = enabled
    },
    insertLog(state, { groupId, log }) {
      _(groupId).logs.push(log)
      save('log', groupId, _(groupId).logs)
    },
    updateLogs(state, { groupId, logs }) {
      _(groupId).logs = logs
      save('log', groupId, logs)
    },
    setGameBgm(state, { groupId, bgm }) {
      _(groupId).bgm = bgm
    },
    addNote(state, { groupId, note }) {
      _(groupId).notes.push(note)
      save('note', groupId, _(groupId).notes)
    },
    updateNotes(state, { groupId, notes }) {
      _(groupId).notes = notes
      save('note', groupId, notes)
    },
    setNoteUnread(state, { groupId, unread }) {
      _(groupId).noteUnread = unread
    },
    setCurrentTab(state, { groupId, tab }) {
      _(groupId).currentTab = tab
    },
    setUserCard(state, { groupId, userId, card }) {
      Vue.set(_(groupId).cards, 'o' + userId, card) // 注意这里加一个字符串，不然纯数字被vue处理后序列化会爆炸
      save('card', groupId, { ..._(groupId).cards, [`o${userId}`]: card }) // 好像不是立刻生效的，先这么写
    },
    setOpenedUserCards(state, { groupId, list }) {
      _(groupId).openedCards = list
    },
    setScene(state, { groupId, sceneUrl }) {
      _(groupId).scene = sceneUrl
    },
    reset(state) {
      Object.assign(state, {
        list: {},
      })
    }
  },
  actions: {
    initGame(context, groupId) {
      if (!context.state.list[groupId]) {
        context.commit('initGame', groupId)
      }
    },
    toggleBotEnabled(context, { groupId, enabled }) {
      return new Promise(((resolve, reject) => {
        (enabled ? enableBot : disableBot)(groupId)
            .then(() => {
              context.commit('toggleBotEnabled', { groupId, enabled })
              resolve()
            })
            .catch(e => {
              // 按照文档说明，重复加群也是成功，但还是会偶现失败，所以做个兜底，给 sdk 擦屁股
              if (e.toString().includes('被邀请加入的用户已经是群成员')) {
                console.log('[bot.switch]already in group')
                context.commit('toggleBotEnabled', { groupId, enabled })
                resolve() // 也是成功
              } else {
                reject(e)
              }
            })
      }))
    },
    insertGameLogs(context, msglist) {
      msglist.filter(msg =>
          msg.conversationType === TIM.TYPES.CONV_GROUP
          && msg.type === TIM.TYPES.MSG_TEXT
          && context.state.list[msg.to]
          && context.state.list[msg.to].logEnabled
      ).forEach(msg => {
        const log = {
          id: msg.ID,
          from: msg.from,
          nick: msg.nameCard || msg.nick,
          time: msg.time,
          content: msg.payload.text,
        }
        if (log.content.startsWith('.') || log.content.startsWith('。')) {
          return // 这里默认过滤了骰子指令，后续可以考虑做成配置项
        }
        context.commit('insertLog', { groupId: msg.to, log })
      })
    },
    handleKPNote(context, msglist) {
      msglist.filter(msg =>
          msg.conversationType === TIM.TYPES.CONV_GROUP
          && msg.priority === TIM.TYPES.MSG_PRIORITY_HIGH
      ).forEach(msg => {
        if (msg.type === TIM.TYPES.MSG_CUSTOM) {
          const data = JSON.parse(msg.payload.data)
          if (data.mtype === 'bgm') {
            context.commit('setGameBgm', { groupId: msg.to, bgm: data.mdata })
            context.dispatch('handleNoteUnread', msg.to)
          } else if (data.mtype === 'card') {
            context.commit('setUserCard', { groupId: msg.to, userId: data.mdata.userId, card: data.mdata.card })
          } else if (data.mtype === 'scene') {
            context.commit('setScene', { groupId: msg.to, sceneUrl: data.mdata })
          }
        } else if (msg.type === TIM.TYPES.MSG_TEXT) {
          context.commit('addNote', {
            groupId: msg.to,
            note: { id: msg.ID, type: msg.type, payload: msg.payload.text }
          })
          context.dispatch('handleNoteUnread', msg.to)
        } else if (msg.type === TIM.TYPES.MSG_IMAGE) {
          context.commit('addNote', {
            groupId: msg.to,
            note: { id: msg.ID, type: msg.type, payload: msg.payload.imageInfoArray[0].imageUrl }
          })
          context.dispatch('handleNoteUnread', msg.to)
        }
      })
    },
    handleNoteUnread(context, groupId) {
      // 为 note 增加红点，如果用户当前停留在 note tab 则不增加
      if (_(groupId).currentTab !== 'note') {
        context.commit('setNoteUnread', { groupId, unread: true })
      }
    },
    openUserCard(context, { groupId, userId }) {
      // 如果没有导入过人物卡
      const game = _(groupId)
      if (!game.cards['o' + userId]) {
        return new Promise((_, reject) => reject())
      }
      // 如果当前没有打开这个人，就打开
      if (!game.openedCards.includes(userId)) {
        context.commit('setOpenedUserCards', { groupId, list: [...game.openedCards, userId] })
      }
      // 把当前tab 切换到他的人物卡
      context.commit('setCurrentTab', { groupId, tab: userId })
      return new Promise(resolve => resolve())
    },
    closeUserCard(context, { groupId, userId }) {
      const game = _(groupId)
      // 删除自己
      context.commit('setOpenedUserCards', { groupId, list: game.openedCards.filter(id => id !== userId) })
      // 如果删除的正好是当前的tab，就切换到第一个吧
      if (game.currentTab === userId) {
        context.commit('setCurrentTab', { groupId, tab: 'group' })
      }
    },
  }
}

export default game
