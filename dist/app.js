(() => {
  'use strict';

  const STATE_KEY = 'ielts-zhenjing-progress-v1';
  const SESSION_KEY = 'ielts-zhenjing-session-v1';
  const DAY = 86_400_000;
  const $ = id => document.getElementById(id);
  const norm = value => String(value || '').trim().toLocaleLowerCase('en').replace(/[.,;:!?]/g, '').replace(/\s+/g, ' ');
  const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const validImportedWord = value => /^[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ'\-’. ]{0,79}$/.test(String(value || '').trim());
  const isImportHeader = value => /^(word|words|vocabulary|english|英文|英文单词|单词)$/i.test(String(value || '').trim());

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STATE_KEY));
      if (parsed && parsed.version === 1) return parsed;
    } catch (_) {}
    return {version: 1, progress: {}, customWords: [], lastUnitId: '', settings: {sound: true}};
  }

  let state = loadState();
  let catalog = null;
  let entryById = new Map();
  let pendingImport = [];
  const save = () => localStorage.setItem(STATE_KEY, JSON.stringify(state));
  const progressFor = id => state.progress[id] || (state.progress[id] = {seen: 0, firstCorrect: 0, lapseCount: 0, recoveryStreak: 0, dueAt: 0, step: 0, favorite: false, lastSeenAt: 0});

  async function loadCatalog() {
    const response = await fetch('data/catalog.json', {cache: 'force-cache'});
    if (!response.ok) throw new Error('课程数据加载失败');
    catalog = await response.json();
    const custom = state.customWords.map((entry, index) => ({...entry, id: entry.id || `custom-${index}`, chapterId: 'custom', unitId: 'custom-u01', sourceNumber: index + 1, ipa: entry.ipa || '', role: entry.role || 'phrase'}));
    entryById = new Map([...catalog.entries, ...custom].map(entry => [entry.id, entry]));
    return catalog;
  }

  function toast(message) {
    const node = $('toast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove('show'), 2200);
  }

  function getUnitEntries(unitId) {
    if (unitId === 'custom-u01') return state.customWords.map(entry => entryById.get(entry.id)).filter(Boolean);
    return catalog.entries.filter(entry => entry.unitId === unitId);
  }

  function startSession(ids, meta = {}) {
    const unique = [...new Set(ids)].filter(id => entryById.has(id));
    if (!unique.length) return false;
    const session = {ids: unique, unitId: meta.unitId || '', label: meta.label || '自选练习', chapterId: meta.chapterId || '', createdAt: Date.now()};
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    if (session.unitId && session.unitId !== 'review') {
      state.lastUnitId = session.unitId;
      save();
    }
    location.href = `practice.html${session.unitId ? `?unit=${encodeURIComponent(session.unitId)}` : ''}`;
    return true;
  }

  function chapterProgress(chapterId) {
    const entries = catalog.entries.filter(entry => entry.chapterId === chapterId);
    const seen = entries.filter(entry => progressFor(entry.id).seen > 0).length;
    return {seen, total: entries.length, percent: entries.length ? Math.round(seen / entries.length * 100) : 0};
  }

  function dashboardStats() {
    const values = Object.values(state.progress);
    const now = Date.now();
    const seen = values.filter(item => item.seen > 0).length;
    const due = values.filter(item => item.seen > 0 && item.dueAt > 0 && item.dueAt <= now).length;
    const mistakes = values.filter(item => item.lapseCount > 0 && item.recoveryStreak < 2).length;
    const favorites = values.filter(item => item.favorite).length;
    return {seen, due, mistakes, favorites};
  }

  function renderDashboard() {
    const stats = dashboardStats();
    $('navMistakes').textContent = stats.mistakes;
    $('heroDue').textContent = stats.due;
    $('dueStat').textContent = stats.due;
    $('mistakeStat').textContent = stats.mistakes;
    $('favoriteStat').textContent = stats.favorites;
    $('masteryPercent').textContent = `${Math.round(stats.seen / catalog.totalEntries * 100)}%`;
  }

  function renderChapters() {
    const grid = $('chapterGrid');
    grid.innerHTML = '';
    catalog.chapters.forEach(chapter => {
      const progress = chapterProgress(chapter.id);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'chapter-card';
      button.innerHTML = `<span class="chapter-number">CHAPTER ${String(chapter.ordinal).padStart(2, '0')}</span><h3>${escapeHtml(chapter.titleZh)}</h3><p>${chapter.entryCount} 词 · ${chapter.unitCount} 个学习组</p><div class="card-progress"><i style="width:${progress.percent}%"></i></div><div class="chapter-foot"><span>${progress.seen}/${progress.total} 已接触</span><b>${progress.percent}%</b></div>`;
      button.addEventListener('click', () => openChapter(chapter.id));
      grid.appendChild(button);
    });
  }

  function openChapter(chapterId, scroll = true) {
    const chapter = catalog.chapters.find(item => item.id === chapterId);
    if (!chapter) return;
    $('detailEyebrow').textContent = `CHAPTER ${String(chapter.ordinal).padStart(2, '0')}`;
    $('detailTitle').textContent = chapter.titleZh;
    $('detailMeta').textContent = `${chapter.entryCount} 个词 · ${chapter.unitCount} 个 20 词学习组（末组除外）`;
    const grid = $('unitGrid');
    grid.innerHTML = '';
    catalog.units.filter(unit => unit.chapterId === chapterId).forEach(unit => {
      const entries = getUnitEntries(unit.id);
      const seen = entries.filter(entry => progressFor(entry.id).seen > 0).length;
      const card = document.createElement('article');
      card.className = 'unit-card';
      card.innerHTML = `<span>SET ${String(unit.ordinal).padStart(2, '0')}</span><h3>${escapeHtml(unit.title)}</h3><p>本章第 ${unit.rangeLabel} 个词</p><footer><small>${seen}/${unit.entryCount} 已接触</small><button type="button">${seen ? '继续拼写' : '开始拼写'} →</button></footer>`;
      card.querySelector('button').addEventListener('click', () => startSession(entries.map(entry => entry.id), {unitId: unit.id, chapterId, label: `${chapter.titleZh} · ${unit.title}`}));
      grid.appendChild(card);
    });
    $('chapterDetail').hidden = false;
    $('collectionView').hidden = true;
    history.replaceState(null, '', `?chapter=${chapterId}#chapterDetail`);
    if (scroll) $('chapterDetail').scrollIntoView({behavior: 'smooth', block: 'start'});
  }

  function renderSearch(query) {
    const panel = $('searchResults');
    const clean = query.trim().toLocaleLowerCase();
    if (!clean) { panel.hidden = true; panel.innerHTML = ''; return; }
    const chapterHits = catalog.chapters.filter(chapter => chapter.titleZh.includes(clean) || `chapter ${chapter.ordinal}`.includes(clean));
    const wordHits = catalog.entries.filter(entry => entry.word.toLocaleLowerCase().includes(clean) || entry.gloss.toLocaleLowerCase().includes(clean)).slice(0, 80);
    panel.hidden = false;
    panel.innerHTML = `<h3>找到 ${chapterHits.length + wordHits.length} 个可见结果${wordHits.length === 80 ? '（仅显示前 80 个词）' : ''}</h3><div class="word-results"></div>`;
    const list = panel.querySelector('.word-results');
    chapterHits.forEach(chapter => list.appendChild(wordRow({word: `第 ${chapter.ordinal} 章 · ${chapter.titleZh}`, gloss: `${chapter.entryCount} 词 · ${chapter.unitCount} 学习组`}, () => openChapter(chapter.id))));
    wordHits.forEach(entry => list.appendChild(wordRow(entry, () => startSession([entry.id], {unitId: 'search', chapterId: entry.chapterId, label: '搜索结果'}))));
    if (!chapterHits.length && !wordHits.length) list.innerHTML = '<p class="empty-state">没有匹配结果，请尝试更短的英文或中文关键词。</p>';
  }

  function wordRow(entry, action) {
    const row = document.createElement('article');
    row.className = 'word-result';
    row.innerHTML = `<div><h4>${escapeHtml(entry.word)}</h4><p>${escapeHtml(entry.gloss || '')}</p></div><button type="button">去拼写 →</button>`;
    row.querySelector('button').addEventListener('click', action);
    return row;
  }

  function openCollection(type) {
    const pairs = catalog.entries.concat(state.customWords).filter(entry => {
      const p = progressFor(entry.id);
      return type === 'favorites' ? p.favorite : p.lapseCount > 0 && p.recoveryStreak < 2;
    });
    $('collectionTitle').textContent = type === 'favorites' ? '收藏夹' : '错题本';
    $('collectionMeta').textContent = type === 'favorites' ? `你主动收藏了 ${pairs.length} 个词。` : `${pairs.length} 个词需要再次首答正确。`;
    const list = $('collectionList');
    list.innerHTML = '';
    pairs.forEach(entry => list.appendChild(wordRow(entry, () => startSession([entry.id], {unitId: type, label: type === 'favorites' ? '收藏复练' : '错题复练'}))));
    if (!pairs.length) list.innerHTML = `<p class="empty-state">${type === 'favorites' ? '还没有收藏。练习时点击星标即可添加。' : '目前没有需要重练的错词。'}</p>`;
    $('collectionView').hidden = false;
    $('chapterDetail').hidden = true;
    $('collectionView').scrollIntoView({behavior: 'smooth', block: 'start'});
  }

  function parseText(text) {
    return String(text).split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
      const cells = line.split(/[\t,，]/).map(cell => cell.trim());
      return {word: cells[0] || '', gloss: cells.slice(1).join('；') || ''};
    }).filter(item => validImportedWord(item.word) && item.gloss && !isImportHeader(item.word));
  }

  async function readImport(file) {
    try {
      let rows;
      if (/\.xlsx?$/i.test(file.name)) {
        if (!window.XLSX) throw new Error('Excel 解析组件尚未就绪');
        const book = XLSX.read(await file.arrayBuffer(), {type: 'array'});
        const data = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], {header: 1});
        rows = data.map(row => ({word: String(row?.[0] || '').trim(), gloss: String(row?.[1] || '').trim()})).filter(item => validImportedWord(item.word) && item.gloss && !isImportHeader(item.word));
      } else rows = parseText(await file.text());
      const seen = new Set(state.customWords.map(item => norm(item.word)));
      pendingImport = rows.filter(item => { const key = norm(item.word); if (seen.has(key)) return false; seen.add(key); return true; }).map((item, index) => ({...item, id: `custom-${Date.now()}-${index}`}));
      $('importPreview').innerHTML = pendingImport.length ? `已识别 <b>${pendingImport.length}</b> 个新词：<br>${escapeHtml(pendingImport.slice(0, 12).map(item => item.word).join(' · '))}` : '没有找到带中文释义的新词。';
      $('confirmImport').disabled = !pendingImport.length;
    } catch (error) {
      pendingImport = [];
      $('importPreview').textContent = `读取失败：${error.message}`;
      $('confirmImport').disabled = true;
    }
  }

  async function initLibrary() {
    try { await loadCatalog(); } catch (error) { $('chapterGrid').innerHTML = `<p class="empty-state">${escapeHtml(error.message)}，请刷新页面重试。</p>`; return; }
    renderDashboard(); renderChapters();
    const last = catalog.units.some(unit => unit.id === state.lastUnitId) ? state.lastUnitId : catalog.units[0].id;
    const lastUnit = catalog.units.find(unit => unit.id === last);
    const lastChapter = catalog.chapters.find(chapter => chapter.id === lastUnit.chapterId);
    $('continueBtn').textContent = state.lastUnitId ? `继续 ${lastChapter.titleZh} · ${lastUnit.title} →` : `从第 1 章开始 →`;
    $('continueBtn').addEventListener('click', () => startSession(getUnitEntries(last).map(entry => entry.id), {unitId: last, chapterId: lastUnit.chapterId, label: `${lastChapter.titleZh} · ${lastUnit.title}`}));
    $('reviewBtn').addEventListener('click', () => {
      const ids = [...entryById.keys()].filter(id => { const p = progressFor(id); return p.seen > 0 && p.dueAt > 0 && p.dueAt <= Date.now(); });
      if (!startSession(ids.slice(0, 30), {unitId: 'review', label: '到期复习'})) toast('目前没有到期词，可以先开始一个新学习组。');
    });
    $('catalogSearch').addEventListener('input', event => renderSearch(event.target.value));
    document.addEventListener('keydown', event => { if (event.key === '/' && document.activeElement !== $('catalogSearch')) { event.preventDefault(); $('catalogSearch').focus(); } });
    document.querySelectorAll('[data-open-view]').forEach(button => button.addEventListener('click', () => openCollection(button.dataset.openView)));
    $('closeDetail').addEventListener('click', () => { $('chapterDetail').hidden = true; history.replaceState(null, '', 'index.html#chapters'); });
    $('closeCollection').addEventListener('click', () => { $('collectionView').hidden = true; });
    document.querySelectorAll('[data-open-import]').forEach(button => button.addEventListener('click', () => $('importDialog').showModal()));
    $('fileInput').addEventListener('change', event => event.target.files[0] && readImport(event.target.files[0]));
    $('confirmImport').addEventListener('click', () => {
      state.customWords.push(...pendingImport); save();
      pendingImport.forEach(entry => entryById.set(entry.id, {...entry, chapterId: 'custom', unitId: 'custom-u01', ipa: ''}));
      $('importDialog').close();
      startSession(pendingImport.map(entry => entry.id), {unitId: 'custom-u01', chapterId: 'custom', label: '自定义词表'});
    });
    const chapterParam = new URLSearchParams(location.search).get('chapter');
    if (chapterParam) openChapter(chapterParam, false);
  }

  /* Practice */
  let session;
  let queue = [];
  let index = 0;
  let attempts = 0;
  let revealed = false;
  let moving = false;
  let sessionStreak = 0;
  let sessionStats = {firstCorrect: 0, retry: new Set(), revealed: new Set(), favorites: new Set()};

  function currentEntry() { return entryById.get(queue[index]); }
  function sessionChapter() { return catalog.chapters.find(chapter => chapter.id === currentEntry()?.chapterId); }

  function bestVoice() {
    if (!('speechSynthesis' in window)) return null;
    return speechSynthesis.getVoices().filter(voice => /^en/i.test(voice.lang)).sort((a, b) => voiceScore(b) - voiceScore(a))[0] || null;
  }
  function voiceScore(voice) {
    const value = `${voice.name} ${voice.lang}`.toLowerCase();
    let score = /^en-gb/i.test(voice.lang) ? 40 : 10;
    if (/natural|neural|premium|enhanced/.test(value)) score += 120;
    if (/ryan|sonia|libby|daniel|serena|samantha|google uk/.test(value)) score += 65;
    if (/compact|espeak|robot/.test(value)) score -= 150;
    return score;
  }
  function speak(entry) {
    if (norm(entry.word) === 'sustainable') {
      const neuralClip = new Audio('audio/sustainable-ryan.mp3');
      neuralClip.volume = 1;
      neuralClip.play().catch(() => speakSystem(entry));
      return;
    }
    speakSystem(entry);
  }
  function speakSystem(entry) {
    if (!('speechSynthesis' in window)) return toast('当前设备不支持系统语音。');
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(entry.word);
    const voice = bestVoice();
    utterance.voice = voice;
    utterance.lang = voice?.lang || 'en-GB';
    utterance.rate = .82; utterance.pitch = 1; utterance.volume = 1;
    speechSynthesis.speak(utterance);
  }

  function audioContext() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    const context = keySound.context || (keySound.context = new AudioCtx());
    if (context.state === 'suspended') context.resume();
    return context;
  }
  function noiseBuffer(context, duration) {
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    return buffer;
  }
  function keySound(backspace = false) {
    if (!state.settings.sound) return;
    const context = audioContext(); if (!context) return;
    const now = context.currentTime;
    const top = context.createBufferSource(), body = context.createBufferSource();
    const high = context.createBiquadFilter(), low = context.createBiquadFilter();
    const topGain = context.createGain(), bodyGain = context.createGain();
    top.buffer = noiseBuffer(context, .022); body.buffer = noiseBuffer(context, backspace ? .045 : .07);
    high.type = 'bandpass'; high.frequency.value = backspace ? 1650 : 2750; high.Q.value = 1.7;
    low.type = 'lowpass'; low.frequency.value = backspace ? 360 : 520;
    topGain.gain.setValueAtTime(.23, now); topGain.gain.exponentialRampToValueAtTime(.0001, now + .022);
    bodyGain.gain.setValueAtTime(.18, now); bodyGain.gain.exponentialRampToValueAtTime(.0001, now + (backspace ? .045 : .07));
    top.connect(high).connect(topGain).connect(context.destination); body.connect(low).connect(bodyGain).connect(context.destination);
    top.start(now); body.start(now + .004); top.stop(now + .024); body.stop(now + .075);
  }

  function setFeedback(message, kind) {
    const node = $('feedback'); node.textContent = message; node.className = `feedback show ${kind}`;
  }
  function clearFeedback() { $('feedback').textContent = ''; $('feedback').className = 'feedback'; }

  function renderQuestion() {
    const entry = currentEntry();
    if (!entry) return finishSession();
    moving = false; attempts = 0; revealed = false;
    const chapter = sessionChapter();
    $('practiceChapter').textContent = chapter ? `CHAPTER ${String(chapter.ordinal).padStart(2, '0')} · ${chapter.titleZh}` : '自定义词表';
    $('practiceUnit').textContent = session.label || '拼写练习';
    $('questionNo').textContent = index + 1; $('questionTotal').textContent = queue.length;
    $('progressBar').style.width = `${index / queue.length * 100}%`;
    $('entrySource').textContent = chapter ? `原书编号 ${entry.sourceNumber}` : '自定义词条';
    $('meaning').textContent = entry.gloss || '未填写中文释义';
    const letters = [...entry.word].filter(char => /[A-Za-zÀ-ɏ]/.test(char)).length;
    $('wordLength').textContent = `${letters} 个字母${entry.word.includes(' ') ? ' · 多词短语' : ''}`;
    $('ipaValue').textContent = entry.ipa ? `/${entry.ipa}/` : '暂无音标'; $('ipaValue').hidden = true;
    $('answerInput').value = ''; $('answerInput').placeholder = 'TYPE THE WORD'; $('answerInput').disabled = false;
    $('favoriteBtn').textContent = progressFor(entry.id).favorite ? '★' : '☆'; $('favoriteBtn').classList.toggle('saved', progressFor(entry.id).favorite);
    $('sessionStreak').textContent = sessionStreak; $('firstCorrect').textContent = sessionStats.firstCorrect; $('sessionWrong').textContent = sessionStats.retry.size;
    clearFeedback(); setTimeout(() => $('answerInput').focus({preventScroll: true}), 0);
  }

  function markWrong(entry) {
    const p = progressFor(entry.id);
    p.seen += 1; p.lapseCount += 1; p.recoveryStreak = 0; p.lastSeenAt = Date.now(); p.dueAt = Date.now() + 10 * 60_000;
    sessionStats.retry.add(entry.id); sessionStreak = 0; save();
  }

  function reveal(entry, skipped = false) {
    if (!attempts) { attempts = 2; markWrong(entry); }
    revealed = true; sessionStats.revealed.add(entry.id);
    $('answerInput').value = ''; $('answerInput').placeholder = '重新输入正确拼写';
    setFeedback(`正确拼写：${entry.word}。${skipped ? '已记为待巩固；' : ''}请亲手重新输入，按 Enter 进入下一题。`, 'answer');
    speak(entry); $('answerInput').focus();
  }

  function scheduleCorrect(entry, firstTry) {
    const p = progressFor(entry.id); const now = Date.now();
    p.seen += 1; p.lastSeenAt = now;
    if (firstTry) {
      p.firstCorrect += 1; p.recoveryStreak = Math.min(2, (p.recoveryStreak || 0) + 1); p.step = Math.min(5, (p.step || 0) + 1);
      const intervals = [10 * 60_000, DAY, 3 * DAY, 7 * DAY, 14 * DAY, 30 * DAY];
      p.dueAt = now + intervals[p.step - 1];
    } else {
      p.step = 0; p.dueAt = now + 10 * 60_000;
    }
    save();
  }

  function submitAnswer(event) {
    event.preventDefault(); if (moving) return;
    const entry = currentEntry(); const input = $('answerInput'); const answer = norm(input.value);
    if (!answer) return setFeedback('请先输入你的拼写。', 'no');
    if (answer === norm(entry.word)) {
      const firstTry = attempts === 0 && !revealed;
      if (firstTry) { sessionStats.firstCorrect += 1; sessionStreak += 1; }
      scheduleCorrect(entry, firstTry);
      moving = true; setFeedback(firstTry ? '✓ 首次拼写正确，已安排下次复习。' : '✓ 纠错输入完成，已加入待巩固队列。', 'ok');
      $('sessionStreak').textContent = sessionStreak; $('firstCorrect').textContent = sessionStats.firstCorrect;
      speak(entry); showReward(); setTimeout(nextQuestion, 760); return;
    }
    if (revealed) { setFeedback('还没有与刚才显示的拼写完全一致，请再输入一次。', 'no'); input.select(); return; }
    attempts += 1;
    if (attempts === 1) { markWrong(entry); setFeedback(`第一次未通过。答案仍保持隐藏，请再试一次（${[...entry.word].filter(char => /[A-Za-zÀ-ɏ]/.test(char)).length} 个字母）。`, 'no'); input.select(); }
    else reveal(entry);
  }

  function showReward() {
    const node = $('successFlare'); node.classList.remove('show'); void node.offsetWidth; node.classList.add('show');
    if ([3, 5, 10, 20].includes(sessionStreak)) toast(`${sessionStreak} 连续首答正确 · 保持节奏`);
  }
  function nextQuestion() { index += 1; if (index >= queue.length) finishSession(); else renderQuestion(); }

  function finishSession() {
    $('progressBar').style.width = '100%';
    $('summaryCorrect').textContent = `${sessionStats.firstCorrect}/${queue.length}`;
    $('summaryRetry').textContent = sessionStats.retry.size; $('summaryReveal').textContent = sessionStats.revealed.size; $('summaryFavorite').textContent = sessionStats.favorites.size;
    $('retryWrongBtn').disabled = !sessionStats.retry.size;
    $('retryWrongBtn').onclick = () => {
      queue = [...sessionStats.retry]; index = 0; sessionStats = {firstCorrect: 0, retry: new Set(), revealed: new Set(), favorites: new Set()}; $('summaryDialog').close(); renderQuestion();
    };
    const currentUnit = catalog.units.find(unit => unit.id === session.unitId); const next = currentUnit && catalog.units.find(unit => unit.chapterId === currentUnit.chapterId && unit.ordinal === currentUnit.ordinal + 1);
    if (next) {
      $('nextUnitBtn').textContent = `下一学习组 · ${next.title} →`;
      $('nextUnitBtn').onclick = event => { event.preventDefault(); startSession(getUnitEntries(next.id).map(entry => entry.id), {unitId: next.id, chapterId: next.chapterId, label: `${sessionChapter()?.titleZh || ''} · ${next.title}`}); };
    } else { $('nextUnitBtn').textContent = '返回课程目录 →'; $('nextUnitBtn').href = 'index.html'; }
    $('summaryDialog').showModal();
  }

  async function initPractice() {
    try { await loadCatalog(); } catch (error) { toast(error.message); setTimeout(() => location.href = 'index.html', 1300); return; }
    try { session = JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (_) {}
    const requested = new URLSearchParams(location.search).get('unit');
    if (requested && (!session || session.unitId !== requested)) {
      const unit = catalog.units.find(item => item.id === requested);
      if (unit) { const chapter = catalog.chapters.find(item => item.id === unit.chapterId); session = {ids: getUnitEntries(unit.id).map(entry => entry.id), unitId: unit.id, chapterId: unit.chapterId, label: `${chapter.titleZh} · ${unit.title}`}; }
    }
    if (!session?.ids?.length) { const unit = catalog.units[0]; session = {ids: getUnitEntries(unit.id).map(entry => entry.id), unitId: unit.id, chapterId: unit.chapterId, label: `自然地理 · ${unit.title}`}; }
    queue = session.ids.filter(id => entryById.has(id)); if (!queue.length) return location.href = 'index.html';
    $('answerForm').addEventListener('submit', submitAnswer);
    $('skipBtn').addEventListener('click', () => reveal(currentEntry(), true));
    $('listenBtn').addEventListener('click', () => speak(currentEntry()));
    $('ipaBtn').addEventListener('click', () => { $('ipaValue').hidden = !$('ipaValue').hidden; });
    $('favoriteBtn').addEventListener('click', () => { const entry = currentEntry(); const p = progressFor(entry.id); p.favorite = !p.favorite; if (p.favorite) sessionStats.favorites.add(entry.id); else sessionStats.favorites.delete(entry.id); save(); $('favoriteBtn').textContent = p.favorite ? '★' : '☆'; $('favoriteBtn').classList.toggle('saved', p.favorite); });
    $('soundToggle').setAttribute('aria-pressed', String(state.settings.sound));
    $('soundToggle').addEventListener('click', () => { state.settings.sound = !state.settings.sound; save(); $('soundToggle').setAttribute('aria-pressed', String(state.settings.sound)); if (state.settings.sound) { audioContext(); keySound(); } });
    $('answerInput').addEventListener('pointerdown', audioContext);
    $('answerInput').addEventListener('keydown', event => { audioContext(); if (event.key === 'Backspace') keySound(true); });
    $('answerInput').addEventListener('input', event => { if (event.data && !event.inputType?.startsWith('delete')) keySound(false); });
    if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => bestVoice();
    renderQuestion();
  }

  document.body.dataset.page === 'practice' ? initPractice() : initLibrary();
})();
