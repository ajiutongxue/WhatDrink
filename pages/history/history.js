var data = require('../../utils/data');
var teaData = require('../../utils/teaData');
var llm = require('../../utils/llm');
var tracker = require('../../utils/tracker');

Page({
  data: {
    historyList: [],
    editingIdx: -1,   // currently editing history index (-1 = none)
    editingText: '',
    editingImages: []
  },

  _appData: null,

  onShow: function () {
    this._loadHistory();
  },

  onTapStats: function () {
    wx.navigateTo({ url: '/pages/stats/stats' });
  },

  // Called by app.js after cloud sync completes
  reloadData: function () {
    this._loadHistory();
  },

  _loadHistory: function () {
    var appData = data.load();
    this._appData = appData;
    var history = appData.history || [];
    var temporaryAvoids = appData.temporaryAvoids || {};
    var now = Date.now();
    var list = [];

    var typeMap = { primary: '主推', alt: '备选', custom: '自选', skip: '' };
    var badgeMap = {
      primary: 'history-badge-primary',
      alt: 'history-badge-alt',
      custom: 'history-badge-custom',
      skip: ''
    };

    // Reverse order (newest first), track original index for editing
    for (var i = history.length - 1; i >= 0; i--) {
      var h = history[i];
      var catName = teaData.CAT_NAMES[h.teaCat] || '';
      if (h.teaCat === 'unknown') catName = '自定义';
      if (h.teaCat === 'none') catName = '';

      var avoidState = temporaryAvoids[String(h.teaId)] || {};
      var temporarilyAvoided = avoidState.active === true && Number(avoidState.expiresAt) > now;
      list.push({
        idx: i,  // original index in history array
        dateShort: h.date.slice(5),
        checkinTime: h.checkinTime || '',
        teaId: h.teaId,
        teaName: h.teaName,
        teaBrand: h.teaBrand || '',
        teaCat: h.teaCat || 'green',
        teaCatName: catName,
        isSkip: h.type === 'skip',
        canTemporarilyAvoid: typeof h.teaId === 'number' && h.teaId >= 0,
        temporarilyAvoided: temporarilyAvoided,
        typeName: typeMap[h.type] || '',
        typeBadgeClass: badgeMap[h.type] || '',
        hasNotes: !!(h.tastingNotes && h.tastingNotes.length > 0) || !!(h.imageFileIDs && h.imageFileIDs.length > 0),
        tastingNotes: h.tastingNotes || '',
        imageFileIDs: h.imageFileIDs || []
      });
    }

    // 编辑中不重置编辑状态（避免 chooseMedia 返回触发 sync→reloadData 退出编辑）
    var update = { historyList: list };
    if (this.data.editingIdx < 0) {
      update.editingIdx = -1;
      update.editingText = '';
      update.editingImages = [];
    }
    this.setData(update);
  },

  // ==== Tasting Notes ====
  onToggleNotes: function (e) {
    var idx = parseInt(e.currentTarget.dataset.idx);
    if (this.data.editingIdx === idx) {
      this.setData({ editingIdx: -1, editingText: '', editingImages: [] });
    } else {
      var history = (this._appData && this._appData.history) || [];
      var existing = (history[idx] && history[idx].tastingNotes) || '';
      var existingImgs = (history[idx] && history[idx].imageFileIDs) ? history[idx].imageFileIDs.slice() : [];
      this.setData({ editingIdx: idx, editingText: existing, editingImages: existingImgs });
    }
  },

  onNotesInput: function (e) {
    this.setData({ editingText: e.detail.value });
  },

  onChooseImage: function () {
    var self = this;
    var current = this.data.editingImages || [];
    var remain = 6 - current.length;
    if (remain <= 0) {
      wx.showToast({ title: '最多 6 张', icon: 'none' });
      return;
    }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: function (res) {
        var files = res.tempFiles || [];
        if (files.length === 0) return;
        var appData = self._appData || data.load();
        var history = appData.history || [];
        var idx = self.data.editingIdx;
        var entry = (idx >= 0 && history[idx]) ? history[idx] : {};
        var dateStr = entry.date || '';
        var teaId = entry.teaId || 0;
        var ts = Date.now();
        var uploaded = current.slice();
        var pending = files.length;
        wx.showLoading({ title: '上传中' });
        files.forEach(function (f, i) {
          var cloudPath = 'tasting-images/' + dateStr + '_' + teaId + '_' + ts + '_' + i + '.jpg';
          wx.cloud.uploadFile({
            cloudPath: cloudPath,
            filePath: f.tempFilePath,
            success: function (upRes) {
              uploaded.push({ fileID: upRes.fileID, caption: '' });
            },
            fail: function (err) {
              console.warn('upload failed', cloudPath, err);
            },
            complete: function () {
              pending--;
              if (pending === 0) {
                wx.hideLoading();
                self.setData({ editingImages: uploaded });
              }
            }
          });
        });
      }
    });
  },

  onPreviewImage: function (e) {
    var src = e.currentTarget.dataset.src;
    var listIdx = e.currentTarget.dataset.listIdx;
    var images;
    if (listIdx !== undefined && listIdx !== '') {
      var item = this.data.historyList[listIdx];
      images = (item && item.imageFileIDs) || [];
    } else {
      images = this.data.editingImages || [];
    }
    if (images.length === 0) return;
    var fileIDs = images.map(function (img) { return img.fileID; });
    var srcIdx = fileIDs.indexOf(src);
    wx.showLoading({ title: '加载中' });
    wx.cloud.getTempFileURL({
      fileList: fileIDs,
      success: function (res) {
        wx.hideLoading();
        var httpsUrls = (res.fileList || []).map(function (f) { return f.tempFileURL; }).filter(Boolean);
        if (httpsUrls.length === 0) return;
        var current = (srcIdx >= 0 && srcIdx < httpsUrls.length) ? httpsUrls[srcIdx] : httpsUrls[0];
        wx.previewImage({ current: current, urls: httpsUrls });
      },
      fail: function () {
        wx.hideLoading();
        wx.showToast({ title: '预览失败', icon: 'none' });
      }
    });
  },

  onRemoveImage: function (e) {
    var idx = e.currentTarget.dataset.idx;
    var self = this;
    var images = (this.data.editingImages || []).slice();
    var fileId = images[idx] ? images[idx].fileID : '';
    if (!fileId) return;
    wx.showModal({
      title: '删除图片',
      content: '确定删除这张图片吗？',
      success: function (res) {
        if (!res.confirm) return;
        images.splice(idx, 1);
        self.setData({ editingImages: images });
        wx.cloud.deleteFile({
          fileList: [fileId],
          fail: function (err) { console.warn('deleteFile failed', fileId, err); }
        });
      }
    });
  },

  onCaptionInput: function (e) {
    var idx = e.currentTarget.dataset.idx;
    var images = (this.data.editingImages || []).slice();
    if (images[idx]) {
      images[idx] = { fileID: images[idx].fileID, caption: e.detail.value };
      this.setData({ editingImages: images });
    }
  },

  onSaveNotes: function () {
    var text = (this.data.editingText || '').trim();
    var imgs = this.data.editingImages || [];
    var idx = this.data.editingIdx;
    if (idx < 0) return;

    var appData = this._appData || data.load();
    var analyze = false;
    var sourceUpdatedAt = 0;
    var entryId = '';
    if (idx < appData.history.length) {
      var entry = appData.history[idx];
      var previousText = entry.tastingNotes || '';
      var now = Date.now();
      entry.tastingNotes = text;
      entry.imageFileIDs = imgs.slice();
      entry.updatedAt = now;
      entryId = entry.id || '';
      if (text !== previousText) {
        entry.notesUpdatedAt = now;
        sourceUpdatedAt = now;
        delete entry.noteAnalysis;
        analyze = !!text && appData.llm && appData.llm.noteAnalysisEnabled !== false;
      }
      data.save(appData);
      tracker.track('tasting_note_saved', { source: 'history', chars: text.length, images: imgs.length, analysisRequested: analyze });
      this._appData = appData;
    }

    this._loadHistory();
    this.setData({ editingIdx: -1, editingText: '', editingImages: [] });
    wx.showToast({ title: (text || imgs.length > 0) ? '已保存' : '已清空', icon: 'success', duration: 1200 });
    if (analyze) this._analyzeSavedNote(entryId, idx, sourceUpdatedAt);
  },

  _analyzeSavedNote: function (entryId, originalIdx, sourceUpdatedAt) {
    var appData = this._appData || data.load();
    var entry = appData.history[originalIdx];
    if (!entry || Number(entry.notesUpdatedAt) !== Number(sourceUpdatedAt)) return;
    var tea = null;
    var library = appData.teaLibrary || teaData.TEAS;
    for (var i = 0; i < library.length; i++) if (library[i] && library[i].id === entry.teaId) { tea = library[i]; break; }
    var self = this;
    llm.analyzeTastingNote(entry.tastingNotes, tea, { sourceUpdatedAt: sourceUpdatedAt }, appData.llm).then(function(analysis) {
      if (!analysis) return;
      var latest = data.load();
      var target = null;
      if (entryId) {
        for (var j = 0; j < latest.history.length; j++) if (latest.history[j].id === entryId) { target = latest.history[j]; break; }
      } else target = latest.history[originalIdx];
      if (!target || Number(target.notesUpdatedAt) !== Number(sourceUpdatedAt)) return;
      target.noteAnalysis = analysis;
      target.updatedAt = Date.now();
      data.save(latest);
      self._appData = latest;
      self._loadHistory();
    });
  },

  onToggleTemporaryAvoid: function (e) {
    var teaId = Number(e.currentTarget.dataset.teaId);
    if (!isFinite(teaId) || teaId < 0) return;
    var appData = this._appData || data.load();
    if (!appData.temporaryAvoids || typeof appData.temporaryAvoids !== 'object') appData.temporaryAvoids = {};
    var key = String(teaId);
    var previous = appData.temporaryAvoids[key] || {};
    var now = Date.now();
    var active = previous.active === true && Number(previous.expiresAt) > now;
    appData.temporaryAvoids[key] = active
      ? { active: false, markedAt: previous.markedAt || 0, expiresAt: previous.expiresAt || 0, updatedAt: now }
      : { active: true, markedAt: now, expiresAt: now + 30 * 86400000, updatedAt: now };
    data.save(appData);
    tracker.track(active ? 'temporary_avoid_clear' : 'temporary_avoid_set', { teaId: teaId, days: active ? 0 : 30 });
    this._appData = appData;
    this._loadHistory();
    wx.showToast({ title: active ? '已恢复推荐' : '30天内不再推荐', icon: 'none' });
  }
});
