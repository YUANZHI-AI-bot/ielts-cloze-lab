(() => {
  "use strict";
  const API = location.hostname.endsWith("github.io") ? "https://ielts-cloze-lab.woodsy-mint-9620.chatgpt.site" : "";
  let timer = null, ready = false, syncing = false;

  async function request(method, state) {
    const response = await fetch(`${API}/api/v1/public-state`, {
      method,
      headers: method === "PUT" ? { "content-type": "application/json" } : undefined,
      body: method === "PUT" ? JSON.stringify({ state }) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.error || "公开词库暂时不可用。");
    return data;
  }

  function current() { return window.IELTSCloud?.getState?.() || null; }
  function note(value, bad = false) {
    const node = document.getElementById("cloudMessage");
    if (!node) return;
    node.textContent = value || "";
    node.classList.toggle("bad", bad);
  }

  function merge(local, remote) {
    if (!remote) return local;
    if (!local) return remote;
    const preferLocal = Number(local.updatedAt || 0) >= Number(remote.updatedAt || 0);
    const localCards = Array.isArray(local.cards) ? local.cards : [];
    const remoteCards = Array.isArray(remote.cards) ? remote.cards : [];
    const cards = new Map();
    [...remoteCards, ...localCards].forEach((card, index) => {
      const key = String(card.id || card.word || "").toLowerCase();
      const old = cards.get(key), isLocal = index >= remoteCards.length;
      if (!old || Number(card.updatedAt || 0) > Number(old.updatedAt || 0) || (Number(card.updatedAt || 0) === Number(old.updatedAt || 0) && isLocal === preferLocal)) cards.set(key, card);
    });
    const newest = preferLocal ? local : remote;
    return Object.assign({}, remote, local, newest, { cards: [...cards.values()], updatedAt: Date.now() });
  }

  async function synchronize(showMessage = false) {
    if (syncing || !current()) return;
    syncing = true;
    try {
      const remote = await request("GET");
      const state = merge(current(), remote.state);
      window.IELTSCloud.replaceState(state);
      await request("PUT", state);
      ready = true;
      refresh();
      if (showMessage) note("已与公开共享词库同步。");
    } catch (error) {
      if (showMessage) note(error.message, true);
      refresh(false);
    } finally { syncing = false; }
  }

  function queue(state) {
    if (!ready || !state) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try { await request("PUT", state); refresh(); }
      catch (error) { refresh(false); }
    }, 650);
  }

  function refresh(online = ready) {
    const status = document.getElementById("cloudStatus");
    const button = document.getElementById("cloudSyncButton");
    if (!status) return;
    status.innerHTML = online
      ? '<span class="cloud-dot online"></span><div><b>公开共享词库已连接</b><small>任何设备打开后都会自动读取和同步。</small></div>'
      : '<span class="cloud-dot"></span><div><b>正在连接公开共享词库</b><small>连接恢复后会自动同步。</small></div>';
    button?.classList.toggle("connected", online);
  }

  function mount() {
    const holder = document.querySelector(".top-actions") || document.querySelector(".topbar");
    if (!holder || document.getElementById("cloudSyncButton")) return;
    const button = document.createElement("button");
    button.id = "cloudSyncButton";
    button.className = "cloud-sync-button";
    button.type = "button";
    button.innerHTML = '<span class="cloud-dot"></span><span>公开共享词库</span>';
    button.onclick = () => { refresh(); note(""); document.getElementById("cloudSyncDialog")?.showModal?.(); };
    holder.append(button);
    const dialog = document.createElement("dialog");
    dialog.id = "cloudSyncDialog";
    dialog.className = "cloud-dialog";
    dialog.innerHTML = '<form method="dialog" class="cloud-sheet"><button class="cloud-close" value="cancel" aria-label="关闭公开共享词库">×</button><p class="eyebrow">PUBLIC SHARED DECK</p><h2>公开共享词库</h2><p class="cloud-copy">无需帐号或口令。所有访客共用同一份单词、收藏、错题本和复习进度，打开网站就会自动同步。</p><div id="cloudStatus" class="cloud-status"></div><section class="cloud-section"><h3>请勿保存私人内容</h3><p class="cloud-copy">其他访客可以查看并修改这份词库。适合共同维护的雅思学习词表。</p><button id="cloudNowBtn" class="soft" type="button">立即同步</button></section><p id="cloudMessage" class="cloud-message" role="status"></p></form>';
    document.body.append(dialog);
    document.getElementById("cloudNowBtn").onclick = () => synchronize(true);
    refresh();
    synchronize();
  }

  window.IELTSCloud = Object.assign(window.IELTSCloud || {}, { queue, start: mount });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
})();
