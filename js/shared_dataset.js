(function (global) {
  const STORAGE_KEY = 'prevyo_shared_dataset_v1';
  const CHANNEL_NAME = 'prevyo_shared_dataset_channel_v1';
  const INSTANCE_ID = 'prevyo_' + Math.random().toString(36).slice(2);
  const listeners = new Set();

  let channel = null;

  function safeParse(text) {
    try {
      return JSON.parse(text);
    } catch (err) {
      return null;
    }
  }

  function normalizePayload(input, sourceLabel) {
    if (typeof input === 'string') {
      return {
        text: input,
        data: safeParse(input),
        sourceLabel: sourceLabel || 'dataset.json',
        savedAt: Date.now()
      };
    }

    const data = Array.isArray(input) ? input : [input];
    return {
      text: JSON.stringify(data),
      data: data,
      sourceLabel: sourceLabel || 'dataset.json',
      savedAt: Date.now()
    };
  }

  function readPayload() {
    try {
      const raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.text !== 'string') return null;
      if (!parsed.data) parsed.data = safeParse(parsed.text);
      return parsed;
    } catch (err) {
      console.warn('Shared dataset read failed:', err);
      return null;
    }
  }

  function notify(payload) {
    listeners.forEach(function (listener) {
      try {
        listener(payload);
      } catch (err) {
        console.warn('Shared dataset listener failed:', err);
      }
    });
  }

  function persist(payload) {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
      console.warn('Shared dataset save failed:', err);
    }
  }

  function broadcast() {
    if (!channel) return;
    try {
      channel.postMessage({ type: 'dataset-updated', originId: INSTANCE_ID });
    } catch (err) {
      console.warn('Shared dataset broadcast failed:', err);
    }
  }

  function save(input, sourceLabel) {
    const payload = normalizePayload(input, sourceLabel);
    persist(payload);
    broadcast();
    return payload;
  }

  function subscribe(listener, options) {
    options = options || {};
    listeners.add(listener);

    if (options.emitCurrent) {
      const payload = readPayload();
      if (payload) listener(payload);
    }

    return function unsubscribe() {
      listeners.delete(listener);
    };
  }

  if (typeof global.BroadcastChannel === 'function') {
    try {
      channel = new global.BroadcastChannel(CHANNEL_NAME);
      channel.addEventListener('message', function (event) {
        const message = event.data || {};
        if (message.originId === INSTANCE_ID || message.type !== 'dataset-updated') return;
        const payload = readPayload();
        if (payload) notify(payload);
      });
    } catch (err) {
      console.warn('Shared dataset channel unavailable:', err);
      channel = null;
    }
  }

  global.addEventListener('storage', function (event) {
    if (event.key !== STORAGE_KEY) return;
    const payload = readPayload();
    if (payload) notify(payload);
  });

  global.PrevyoSharedDataset = {
    saveText: function (text, sourceLabel) {
      return save(text, sourceLabel);
    },
    saveData: function (data, sourceLabel) {
      return save(data, sourceLabel);
    },
    read: readPayload,
    subscribe: subscribe,
    clear: function () {
      try {
        global.localStorage.removeItem(STORAGE_KEY);
      } catch (err) {
        console.warn('Shared dataset clear failed:', err);
      }
    }
  };
})(window);
