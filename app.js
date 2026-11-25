(() => {
  const $ = (id) => document.getElementById(id);
  const sections = ['home', 'setup', 'lobby', 'game', 'market', 'result'];

  function show(id) {
    sections.forEach((s) => {
      const el = $(s);
      if (el) el.classList.toggle('hidden', s !== id);
    });
  }

  let chosenAvatar = '🧠';
  let mode = 'create';
  let playerId = null;
  let uid = null;
  let roomId = null;
  let roomRef = null;
  let roomData = null;
  let questionDeck = [];
  let timerInterval = null;
  let penaltyCountdownInterval = null;
  let typingTimeout = null;
  let localTimer = 0;
  let answered = false;
  let selectedQuestion = null;
  let mySlot = 0;
  let finishingGame = false;
  let turnAdvanceTimer = null;
  let handledFinishView = false;
  let shownPenaltyIds = new Set();
  let seenReactionIds = new Set();
  let chatOpen = false;
  let lastSeenChatCount = 0;
  let soundMuted = false;
  let wrongSoundStyle = 'laugh'; // 'laugh' | 'siren' | 'vinyl' | 'giggle'
  let recordedMatchId = null;
  let darkMode = false;

  const JOKER_COSTS = {
    fifty: 15,
    plusTime: 15,
    doublePts: 20,
    sabotage: 25
  };

  let used5050OnTurn = -1;
  let hiddenOptionIndices = new Set();
  let doublePointsArmed = false;
  let localStreak = 0;
  let activeBetAmount = 0;

  // --- KARANLIK / GECE MODU & ANİMASYONLAR ---
  const THEME_STORAGE_KEY = 'bd_dark_mode_v1';

  function applyTheme(isDark) {
    darkMode = Boolean(isDark);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, darkMode ? '1' : '0');
    } catch {}

    let styleEl = $('bdDarkThemeStyle');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'bdDarkThemeStyle';
      document.head.appendChild(styleEl);
    }

    styleEl.textContent = `
      @keyframes bdShakeAlarm {
        0%, 100% { transform: translateX(0); }
        20% { transform: translateX(-8px) rotate(-1deg); }
        40% { transform: translateX(8px) rotate(1deg); }
        60% { transform: translateX(-6px); }
        80% { transform: translateX(6px); }
      }
      @keyframes bdBombPulse {
        0%, 100% { box-shadow: inset 0 0 0 0 rgba(239,68,68,0); }
        50% { box-shadow: inset 0 0 42px rgba(239,68,68,.35); }
      }
      .bd-shake { animation: bdShakeAlarm .45s ease; }
      .bd-bomb-danger { animation: bdBombPulse .75s infinite; }
      .bd-active-turn-glow {
        box-shadow: 0 0 0 3px rgba(249,115,22,.45), 0 14px 30px rgba(249,115,22,.18) !important;
        transition: box-shadow .25s ease;
      }
      body.bd-dark {
        background: #0f172a !important;
        color: #f1f5f9 !important;
      }
      body.bd-dark .card,
      body.bd-dark .panel,
      body.bd-dark .market-item,
      body.bd-dark .task-card,
      body.bd-dark #bdPlayerStatsCard,
      body.bd-dark #customPenaltyBox,
      body.bd-dark #bdCustomQuestionBox,
      body.bd-dark #bdLobbySettingsBox {
        background: #1e293b !important;
        color: #f8fafc !important;
        border-color: #334155 !important;
      }
      body.bd-dark .answer {
        background: #0f172a !important;
        color: #f1f5f9 !important;
        border-color: #334155 !important;
      }
      body.bd-dark .answer:hover:not(:disabled) {
        border-color: #fb923c !important;
      }
      body.bd-dark small,
      body.bd-dark .note {
        color: #cbd5e1 !important;
      }
      body.bd-dark input,
      body.bd-dark select,
      body.bd-dark textarea {
        background: #0f172a !important;
        color: #f8fafc !important;
        border-color: #475569 !important;
      }
    `;

    document.body.classList.toggle('bd-dark', darkMode);
    const tBtn = $('bdThemeToggleBtn');
    if (tBtn) {
      tBtn.textContent = darkMode ? '☀️ Açık Tema' : '🌙 Gece Modu';
    }
  }

  try {
    darkMode = localStorage.getItem(THEME_STORAGE_KEY) === '1';
  } catch {}
  applyTheme(darkMode);

  // --- SES MOTORU ---
  let audioCtx = null;

  function getAudioCtx() {
    if (soundMuted) return null;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      if (!audioCtx) {
        audioCtx = new AudioContextClass();
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }
      return audioCtx;
    } catch {
      return null;
    }
  }

  document.addEventListener(
    'pointerdown',
    () => {
      getAudioCtx();
    },
    { passive: true }
  );

  function playTone(freq, duration = 0.14, type = 'sine', gainVal = 0.25, startOffset = 0, slideToFreq = null) {
    const ctx = getAudioCtx();
    if (!ctx) return;

    const run = () => {
      try {
        const startAt = ctx.currentTime + Math.max(0, startOffset);
        const endAt = startAt + Math.max(0.03, duration);

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, startAt);
        if (slideToFreq) {
          osc.frequency.linearRampToValueAtTime(slideToFreq, endAt);
        }

        gain.gain.setValueAtTime(0.001, startAt);
        gain.gain.linearRampToValueAtTime(Math.min(0.6, Math.max(0.01, gainVal)), startAt + 0.015);
        gain.gain.linearRampToValueAtTime(0.001, endAt);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(startAt);
        osc.stop(endAt + 0.02);
      } catch {}
    };

    if (ctx.state === 'suspended') {
      ctx.resume().then(run).catch(run);
    } else {
      run();
    }
  }

  function playClapBurst(startOffset = 0, duration = 0.075, gainVal = 0.45, centerFreq = 1800) {
    const ctx = getAudioCtx();
    if (!ctx) return;

    const run = () => {
      try {
        const sampleCount = Math.max(128, Math.floor(ctx.sampleRate * duration));
        const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < sampleCount; i++) {
          const t = i / sampleCount;
          const env = Math.pow(1 - t, 2.2);
          data[i] = (Math.random() * 2 - 1) * env;
        }

        const startAt = ctx.currentTime + Math.max(0, startOffset);
        const endAt = startAt + duration;

        const src = ctx.createBufferSource();
        src.buffer = buffer;

        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(centerFreq, startAt);
        filter.Q.setValueAtTime(0.9, startAt);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.001, startAt);
        gain.gain.linearRampToValueAtTime(Math.min(0.8, gainVal), startAt + 0.008);
        gain.gain.linearRampToValueAtTime(0.001, endAt);

        src.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        src.start(startAt);
        src.stop(endAt + 0.01);
      } catch {}
    };

    if (ctx.state === 'suspended') {
      ctx.resume().then(run).catch(run);
    } else {
      run();
    }
  }

  function playCorrectSound() {
    const beats = [0, 0.07, 0.14, 0.22, 0.3, 0.38, 0.46, 0.54, 0.62, 0.7, 0.78, 0.86];
    beats.forEach((off, idx) => {
      const vol = idx > 7 ? 0.55 : 0.4;
      playClapBurst(off, 0.07, vol, 1600 + (idx % 4) * 240);
    });

    playTone(523.25, 0.14, 'triangle', 0.22, 0.02);
    playTone(659.25, 0.14, 'triangle', 0.22, 0.16);
    playTone(783.99, 0.18, 'triangle', 0.24, 0.3);
    playTone(1046.5, 0.36, 'triangle', 0.28, 0.46);
  }

  function playWrongSound(customStyle = null) {
    const styleToPlay = customStyle || wrongSoundStyle;

    if (styleToPlay === 'siren') {
      playTone(620, 0.25, 'sawtooth', 0.36, 0, 1020);
      playTone(1020, 0.25, 'sawtooth', 0.36, 0.25, 560);
      playTone(560, 0.32, 'sawtooth', 0.38, 0.5, 1080);
      return;
    }
    if (styleToPlay === 'vinyl') {
      playTone(540, 0.68, 'sawtooth', 0.38, 0, 90);
      playTone(270, 0.68, 'square', 0.24, 0.02, 50);
      return;
    }
    if (styleToPlay === 'giggle') {
      [0, 0.085, 0.17, 0.255, 0.34, 0.43].forEach((off, idx) => {
        playTone(660 + idx * 65, 0.075, 'sine', 0.34, off, 860 + idx * 50);
        playClapBurst(off, 0.03, 0.12, 2600);
      });
      return;
    }

    const laughs = [
      { f: 440, off: 0.0, dur: 0.095, g: 0.36 },
      { f: 495, off: 0.115, dur: 0.095, g: 0.38 },
      { f: 415, off: 0.235, dur: 0.095, g: 0.4 },
      { f: 470, off: 0.355, dur: 0.095, g: 0.42 },
      { f: 390, off: 0.48, dur: 0.1, g: 0.44 },
      { f: 330, off: 0.61, dur: 0.28, g: 0.4 }
    ];

    laughs.forEach((item) => {
      playTone(item.f, item.dur, 'sawtooth', item.g, item.off);
      playTone(item.f * 1.5, item.dur * 0.85, 'square', item.g * 0.55, item.off + 0.01);
      playClapBurst(item.off, 0.035, 0.15, 2400);
    });
  }

  function getRivalTauntSoundStyle() {
    if (!roomData?.players || !uid) return wrongSoundStyle;
    const rival = Object.values(roomData.players).find((p) => !p.spectator && p.slot !== mySlot);
    return rival?.tauntSound || 'laugh';
  }

  function playPenaltySound() {
    playTone(360, 0.13, 'sawtooth', 0.3, 0);
    playTone(270, 0.13, 'sawtooth', 0.32, 0.14);
    playTone(190, 0.28, 'sawtooth', 0.35, 0.28);
  }

  function launchConfetti() {
    const colors = ['#f97316', '#ef4444', '#22c55e', '#3b82f6', '#eab308', '#a855f7'];
    for (let i = 0; i < 42; i++) {
      const p = document.createElement('div');
      const left = Math.random() * 100;
      const delay = Math.random() * 350;
      const size = 7 + Math.random() * 7;
      const color = colors[i % colors.length];
      p.style.cssText = `position:fixed;top:-16px;left:${left}vw;width:${size}px;height:${
        size * 0.65
      }px;background:${color};border-radius:2px;z-index:9600;pointer-events:none;transform:rotate(${
        Math.random() * 360
      }deg);transition:transform 1.8s cubic-bezier(.2,.7,.4,1),opacity 1.8s ease-out;opacity:1;`;
      document.body.appendChild(p);
      setTimeout(() => {
        p.style.transform = `translateY(${window.innerHeight + 60}px) rotate(${
          540 + Math.random() * 360
        }deg)`;
        p.style.opacity = '0';
      }, 25 + delay);
      setTimeout(() => p.remove(), 2100 + delay);
    }
  }

  // --- CANLI İNTERNETTEN RASTGELE TÜRKÇE SORU BULUCU (KODA GÖMÜLÜ HAVUZ YOK) ---
  const RECENT_Q_STORAGE_KEY = 'bd_recent_game_questions_v4';
  const GOOGLE_API_KEY_STORAGE = 'bd_google_cse_key_v1';
  const GOOGLE_CX_STORAGE = 'bd_google_cse_cx_v1';

  const TOPIC_SEEDS = {
    'Genel Kültür': ['Türkiye', 'Dünya', 'İcat', 'ReKOR', 'Sembol', 'Başkent', 'Ünlü Eser'],
    'Bilim': ['Atom', 'Güneş', 'DNA', 'Element', 'Gezegen', 'Hücre', 'Enerji'],
    'Coğrafya': ['Okyanus', 'Dağ', 'Nehir', 'Ada', 'Boğaz', 'Göl', 'Çöl'],
    'Tarih': ['Antlaşma', 'İmparatorluk', 'Medeniyet', 'Devrim', 'Keşif', 'Savaş'],
    'Spor': ['Olimpiyat', 'Futbol', 'Basketbol', 'Tenis', 'Atletizm', 'Satranç'],
    'Teknoloji': ['İnternet', 'Yapay Zeka', 'İşlemci', 'Uydu', 'Veritabanı', 'Algoritma'],
    'Edebiyat': ['Roman', 'Şiir', 'Yazar', 'Tiyatro', 'Destan', 'Hikaye'],
    'Sanat': ['Tablo', 'Heykel', 'Müzik', 'Mimari', 'Sinema', 'Opera']
  };

  function fisherYatesShuffle(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function shuffleQuestionOptions(q) {
    if (!q || !Array.isArray(q.a) || q.a.length < 2) return q;
    const correctAnswerText = q.a[Number(q.k || 0)];
    const shuffledOpts = fisherYatesShuffle(q.a);
    const newK = Math.max(0, shuffledOpts.indexOf(correctAnswerText));
    return {
      ...q,
      a: shuffledOpts,
      k: newK
    };
  }

  function getQuestionKey(q) {
    if (!q) return '';
    return String(q.q || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function getRecentQuestionKeys() {
    try {
      const raw = localStorage.getItem(RECENT_Q_STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function saveRecentQuestionKeys(questions) {
    try {
      const added = (questions || []).map(getQuestionKey).filter(Boolean);
      const merged = [...new Set([...added, ...getRecentQuestionKeys()])].slice(0, 120);
      localStorage.setItem(RECENT_Q_STORAGE_KEY, JSON.stringify(merged));
    } catch {}
  }

  function clearRecentQuestionHistory() {
    try {
      localStorage.removeItem(RECENT_Q_STORAGE_KEY);
    } catch {}
  }

  function decodeHtmlEntities(str) {
    const txt = document.createElement('textarea');
    txt.innerHTML = String(str || '');
    return txt.value;
  }

  async function fetchLiveWikipediaCandidates(seeds, countNeeded) {
    const titles = new Set();
    const summaries = [];

    for (const seed of fisherYatesShuffle(seeds).slice(0, 4)) {
      try {
        const searchUrl = `https://tr.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
          seed
        )}&srlimit=12&sroffset=${Math.floor(Math.random() * 25)}&format=json&origin=*`;
        const sRes = await fetch(searchUrl);
        if (sRes.ok) {
          const sJson = await sRes.json();
          const hits = sJson?.query?.search || [];
          hits.forEach((h) => {
            if (h?.title) titles.add(h.title);
          });
        }
      } catch {}
    }

    // Tamamen rastgele Türkçe Vikipedi sayfaları da ekle
    const randBatches = Math.min(4, Math.max(2, Math.ceil(countNeeded / 3)));
    for (let b = 0; b < randBatches; b++) {
      try {
        const randUrl = `https://tr.wikipedia.org/w/api.php?action=query&list=random&rnnamespace=0&rnlimit=8&format=json&origin=*`;
        const rRes = await fetch(randUrl);
        if (rRes.ok) {
          const rJson = await rRes.json();
          (rJson?.query?.random || []).forEach((item) => {
            if (item?.title) titles.add(item.title);
          });
        }
      } catch {}
    }

    const pickedTitles = fisherYatesShuffle([...titles]).slice(0, Math.max(16, countNeeded * 3));
    for (const title of pickedTitles) {
      try {
        const sumUrl = `https://tr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
        const pRes = await fetch(sumUrl);
        if (!pRes.ok) continue;
        const pJson = await pRes.json();
        const extract = String(pJson?.extract || '').trim();
        const cleanTitle = String(pJson?.title || title).trim();
        if (
          pJson?.type === 'standard' &&
          cleanTitle &&
          extract.length >= 45 &&
          !cleanTitle.toLowerCase().includes('liste') &&
          !cleanTitle.toLowerCase().includes('anlam ayrımı')
        ) {
          const firstSentence = extract.split(/(?<=[.!?])\s+/)[0] || extract.slice(0, 120);
          summaries.push({
            title: cleanTitle,
            answerText: firstSentence.slice(0, 95)
          });
        }
      } catch {}
    }

    return summaries;
  }

  async function fetchGoogleCseQuestions(catVal, difVal) {
    const apiKey = ($('bdGoogleApiKeyInput')?.value || '').trim();
    const cx = ($('bdGoogleCxInput')?.value || '').trim();
    if (!apiKey || !cx) return [];

    try {
      const qTopic =
        catVal && catVal !== 'Karışık'
          ? `${catVal} bilgi yarışması soru nedir`
          : 'türkçe genel kültür bilgi yarışması soru nedir';
      const startIdx = Math.floor(Math.random() * 20) + 1;
      const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(
        apiKey
      )}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(qTopic)}&lr=lang_tr&hl=tr&start=${startIdx}`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      const items = Array.isArray(data.items) ? data.items : [];
      return items
        .filter((it) => it && it.title && it.snippet)
        .map((it, idx) => {
          const cleanTitle = decodeHtmlEntities(it.title).replace(/\s*[-|].*$/, '').trim();
          const cleanSnippet = decodeHtmlEntities(it.snippet).replace(/\s+/g, ' ').trim();
          const rightText = cleanSnippet.slice(0, 80);
          const distractors = items
            .filter((_, j) => j !== idx)
            .map((x) => decodeHtmlEntities(x.snippet || x.title || '').replace(/\s+/g, ' ').trim().slice(0, 80))
            .filter(Boolean);
          while (distractors.length < 3) {
            distractors.push(`Farklı bir kaynak tanımı #${distractors.length + 1}`);
          }
          const opts = fisherYatesShuffle([rightText, ...fisherYatesShuffle(distractors).slice(0, 3)]);
          return shuffleQuestionOptions({
            c: catVal && catVal !== 'Karışık' ? catVal : 'Genel Kültür',
            d: difVal && difVal !== 'Karışık' ? difVal : 'Orta',
            q: `"${cleanTitle}" ile ilgili doğru bilgi hangisidir?`,
            a: opts,
            k: Math.max(0, opts.indexOf(rightText)),
            e: cleanSnippet
          });
        });
    } catch {
      return [];
    }
  }

  async function fetchRandomQuestionsFromWeb(count, catVal, difVal) {
    const targetCount = Math.max(1, Number(count) || 10);
    const cseQuestions = await fetchGoogleCseQuestions(catVal, difVal);

    const allSeeds =
      catVal && catVal !== 'Karışık' && TOPIC_SEEDS[catVal]
        ? TOPIC_SEEDS[catVal]
        : Object.values(TOPIC_SEEDS).flat();

    const wikiItems = await fetchLiveWikipediaCandidates(allSeeds, targetCount);
    const recentSet = new Set(getRecentQuestionKeys());
    const generated = [...cseQuestions];

    for (let i = 0; i < wikiItems.length && generated.length < targetCount + 6; i++) {
      const item = wikiItems[i];
      const otherAnswers = wikiItems
        .filter((_, idx) => idx !== i)
        .map((x) => x.answerText)
        .filter((t) => t && t !== item.answerText);

      if (otherAnswers.length < 3) continue;

      const distractors = fisherYatesShuffle(otherAnswers).slice(0, 3);
      const options = fisherYatesShuffle([item.answerText, ...distractors]);
      const qObj = shuffleQuestionOptions({
        c: catVal && catVal !== 'Karışık' ? catVal : 'Canlı Kaynak',
        d: difVal && difVal !== 'Karışık' ? difVal : ['Kolay', 'Orta', 'Zor'][i % 3],
        q: `"${item.title}" hakkında doğru ifade hangisidir?`,
        a: options,
        k: Math.max(0, options.indexOf(item.answerText)),
        e: `${item.title}: ${item.answerText}`
      });

      if (!recentSet.has(getQuestionKey(qObj))) {
        generated.push(qObj);
      }
    }

    // Yeterli yeni soru çıkmazsa görülen geçmişi temizleyip kalanları doldur
    if (generated.length < targetCount && wikiItems.length >= 4) {
      clearRecentQuestionHistory();
      for (let i = 0; i < wikiItems.length && generated.length < targetCount; i++) {
        const item = wikiItems[i];
        const distractors = fisherYatesShuffle(
          wikiItems.filter((_, idx) => idx !== i).map((x) => x.answerText)
        ).slice(0, 3);
        if (distractors.length < 3) continue;
        const options = fisherYatesShuffle([item.answerText, ...distractors]);
        generated.push(
          shuffleQuestionOptions({
            c: catVal && catVal !== 'Karışık' ? catVal : 'Canlı Kaynak',
            d: difVal && difVal !== 'Karışık' ? difVal : 'Orta',
            q: `"${item.title}" hakkında doğru ifade hangisidir?`,
            a: options,
            k: Math.max(0, options.indexOf(item.answerText)),
            e: `${item.title}: ${item.answerText}`
          })
        );
      }
    }

    const modeVal = $('gameModeSelect')?.value || roomData?.settings?.gameMode || 'standard';
    const finalDeck = fisherYatesShuffle(generated)
      .slice(0, targetCount)
      .map((q, idx) => {
        const copy = { ...q };
        if (modeVal === 'chaos' || (idx + 1) % 3 === 0) {
          const types = ['reverse', 'blind', 'bomb'];
          copy.twist = types[Math.floor(Math.random() * types.length)];
        } else {
          copy.twist = 'normal';
        }
        return copy;
      });

    saveRecentQuestionKeys(finalDeck);
saveRecentQuestionKeys(finalDeck);
    const uniqueByQuestion = [];
    const seenInBatch = new Set();
    for (const item of finalDeck) {
      const key = String(item?.q || '').trim().toLowerCase();
      if (!key || seenInBatch.has(key)) continue;
      seenInBatch.add(key);
      uniqueByQuestion.push(item);
    }
    return uniqueByQuestion.slice(0, targetCount);
  }
  }

  // --- OYUNCU PROFİLİ, UNVANLAR & İSTATİSTİK ---
  const STATS_STORAGE_KEY = 'bd_player_stats_v1';

  function loadStats() {
    try {
      const raw = localStorage.getItem(STATS_STORAGE_KEY);
      return raw
        ? JSON.parse(raw)
        : { games: 0, wins: 0, penaltiesGiven: 0, penaltiesReceived: 0, vetoes: 0 };
    } catch {
      return { games: 0, wins: 0, penaltiesGiven: 0, penaltiesReceived: 0, vetoes: 0 };
    }
  }

  function saveStats(st) {
    try {
      localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(st));
    } catch {}
  }

  function getPlayerTitle(st) {
    if ((st.vetoes || 0) >= 2) return '🛡️ Ceza Savar';
    if ((st.penaltiesGiven || 0) >= 4) return '😈 Ceza Lordu';
    if ((st.wins || 0) >= 3) return '👑 Düello Kralı';
    if ((st.games || 0) >= 2) return '⚔️ Arena Müdavimi';
    return '🌱 Çaylak Düellocu';
  }

  async function syncMyTauntSoundToRoom() {
    if (roomRef && uid && roomData?.players?.[uid]) {
      await roomRef.child(`players/${uid}/tauntSound`).set(wrongSoundStyle).catch(() => {});
    }
  }

  function ensureProfileBadge() {
    const homeSec = $('home');
    if (!homeSec) return;
    let badge = $('bdPlayerStatsCard');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'bdPlayerStatsCard';
      badge.style.cssText =
        'margin-top:14px;padding:12px 14px;border-radius:14px;background:rgba(255,255,255,.88);border:1px solid #e5e7eb;display:flex;gap:12px;flex-wrap:wrap;justify-content:space-between;align-items:center;font-size:.84rem;color:#374151;';
      homeSec.appendChild(badge);
    }
    const st = loadStats();
    const title = getPlayerTitle(st);
    badge.innerHTML = `
      <div>
        <span style="background:#ffedd5;color:#c2410c;padding:2px 8px;border-radius:999px;font-weight:800;margin-right:6px;">${title}</span>
        🎮 Maç: <b>${st.games}</b> · 🏆 Galibiyet: <b>${st.wins}</b> · 🎯 Verilen Ceza: <b>${st.penaltiesGiven}</b> · 🎭 Alınan: <b>${st.penaltiesReceived}</b>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
        <select id="bdWrongSoundSelect" title="Rakip yanlış yapınca çalacak ses" style="padding:4px 8px;border-radius:8px;border:1px solid #d1d5db;font-size:.78rem;">
          <option value="laugh" ${wrongSoundStyle === 'laugh' ? 'selected' : ''}>😂 Gülme Efekti</option>
          <option value="siren" ${wrongSoundStyle === 'siren' ? 'selected' : ''}>🚨 Siren</option>
          <option value="vinyl" ${wrongSoundStyle === 'vinyl' ? 'selected' : ''}>💿 Bozuk Plak</option>
          <option value="giggle" ${wrongSoundStyle === 'giggle' ? 'selected' : ''}>🤭 Kıkırdama</option>
        </select>
        <button type="button" id="bdThemeToggleBtn" class="btn secondary small" style="padding:4px 10px;">${
          darkMode ? '☀️ Açık Tema' : '🌙 Gece Modu'
        }</button>
        <button type="button" id="bdTestClapBtn" class="btn secondary small" style="padding:4px 10px;">👏 Alkış</button>
        <button type="button" id="bdTestLaughBtn" class="btn secondary small" style="padding:4px 10px;">😂 Sesim</button>
        <button type="button" id="bdResetQHistoryBtn" class="btn secondary small" style="padding:4px 10px;">♻️ Soru Geçmişi</button>
        <button type="button" id="bdSoundToggleBtn" class="btn secondary small" style="padding:4px 10px;">${
          soundMuted ? '🔇 Kapalı' : '🔊 Açık'
        }</button>
      </div>
    `;

    $('bdWrongSoundSelect').onchange = async (e) => {
      wrongSoundStyle = e.target.value;
      await syncMyTauntSoundToRoom();
      playWrongSound(wrongSoundStyle);
    };
    $('bdThemeToggleBtn').onclick = () => applyTheme(!darkMode);
    $('bdTestClapBtn').onclick = () => {
      soundMuted = false;
      ensureProfileBadge();
      playCorrectSound();
    };
    $('bdTestLaughBtn').onclick = () => {
      soundMuted = false;
      ensureProfileBadge();
      playWrongSound(wrongSoundStyle);
    };
    $('bdSoundToggleBtn').onclick = () => {
      soundMuted = !soundMuted;
      ensureProfileBadge();
      toast(soundMuted ? 'Ses efektleri kapatıldı.' : 'Ses efektleri açıldı.');
    };
    $('bdResetQHistoryBtn').onclick = () => {
      clearRecentQuestionHistory();
      toast('Görülen soru geçmişi sıfırlandı.');
    };
  }

  function recordMatchStatsOnce() {
    if (!roomData || roomData.status !== 'finished' || !uid) return;
    const matchKey = `${roomId || 'room'}_${roomData.startedAt || roomData.createdAt || 'end'}`;
    if (recordedMatchId === matchKey) return;
    recordedMatchId = matchKey;

    const tasks = Array.isArray(roomData.tasks) ? roomData.tasks : Object.values(roomData.tasks || {});
    const givenCount = tasks.filter((t) => t && t.sender === uid).length;
    const recvCount = tasks.filter((t) => t && t.target === uid).length;
    const vetoCount = tasks.filter((t) => t && t.target === uid && t.status === 'vetoed').length;

    const players = Object.values(roomData.players || {});
    const me = roomData.players?.[uid];
    const rival = players.find((p) => !p.spectator && p.slot !== mySlot);
    const won = Boolean(me && (!rival || Number(me.score || 0) > Number(rival.score || 0)));

    if (won) launchConfetti();

    const st = loadStats();
    st.games += 1;
    if (won) st.wins += 1;
    st.penaltiesGiven += givenCount;
    st.penaltiesReceived += recvCount;
    st.vetoes = (st.vetoes || 0) + vetoCount;
    saveStats(st);
    ensureProfileBadge();
  }

  // --- AVATAR SEÇİMİ ---
  const avatarList = ['🧠', '🔥', '🦊', '🐼', '🦁', '🐸', '👽', '🤖', '🐵', '🐯', '🐙', '🦄'];
  if ($('avatars')) {
    avatarList.forEach((a, i) => {
      const b = document.createElement('button');
      b.className = 'avatar-choice' + (i === 0 ? ' selected' : '');
      b.textContent = a;
      b.type = 'button';
      b.onclick = () => {
        chosenAvatar = a;
        document.querySelectorAll('.avatar-choice').forEach((x) => x.classList.remove('selected'));
        b.classList.add('selected');
      };
      $('avatars').appendChild(b);
    });
  }

  // --- SETUP EKRANINDA OYUN MODU ("Sayı Bulmaca" DAHİL) & CANLI SORU KAYNAĞI ---
// --- SETUP EKRANINDA OYUN MODU ("Sayı Bulmaca" DAHİL) & ANAHTARSIZ CANLI SORU ---
  function ensureSetupExtras() {
    const setupSec = $('setup');
    const contBtn = $('continueBtn');
    if (!setupSec || !contBtn || $('bdGameModeBox')) return;

    const modeBox = document.createElement('div');
    modeBox.id = 'bdGameModeBox';
    modeBox.style.cssText = 'margin:10px 0;display:flex;gap:8px;flex-wrap:wrap;align-items:center;';
    modeBox.innerHTML = `
      <label style="font-size:.86rem;font-weight:700;">Oyun Modu:
        <select id="gameModeSelect" style="padding:6px 10px;border-radius:10px;border:1px solid #d1d5db;margin-left:6px;">
          <option value="standard">⚔️ Standart Düello</option>
          <option value="lightning">⚡ Yıldırım Hızı (7 sn)</option>
          <option value="chaos">🌀 Tam Kaos (Ters Köşe + Bomba + Gizli Puan)</option>
          <option value="number_puzzle">🔢 Sayı Bulmaca (Sınırsız Sayı + Soru Sor/Cevapla + 10 Tahmin Hakkı)</option>
        </select>
      </label>
    `;
    contBtn.parentNode.insertBefore(modeBox, contBtn);

    const liveBox = document.createElement('div');
    liveBox.id = 'bdGoogleSourceBox';
    liveBox.style.cssText =
      'margin:10px 0;padding:12px;border-radius:14px;background:#fff;border:1px solid #e5e7eb;';
    liveBox.innerHTML = `
      <b style="display:block;margin-bottom:6px;font-size:.88rem;">🌐 Canlı İnternetten Rastgele Türkçe Soru (API Key İstemez)</b>
      <div style="display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;">
        <span id="bdGoogleFetchStatus" style="font-size:.78rem;color:#475569;">Her oyunda canlı kaynaktan tekrarsız ve rastgele sorular çekilir.</span>
        <button type="button" id="bdGoogleFetchNowBtn" class="btn secondary small">Rastgele Soru Test Et</button>
      </div>
    `;
    contBtn.parentNode.insertBefore(liveBox, contBtn);

    const syncModeVisibility = () => {
      const isPuzzle = $('gameModeSelect')?.value === 'number_puzzle';
      if ($('bdGoogleSourceBox')) $('bdGoogleSourceBox').classList.toggle('hidden', isPuzzle);
    };
    $('gameModeSelect').onchange = syncModeVisibility;
    syncModeVisibility();

    $('bdGoogleFetchNowBtn').onclick = async () => {
      $('bdGoogleFetchStatus').textContent = '⏳ Canlı kaynaktan rastgele sorular çekiliyor...';
      const sample = await fetchRandomQuestionsFromWeb(
        Number($('qCount')?.value) || 5,
        $('category')?.value || 'Karışık',
        $('difficulty')?.value || 'Karışık'
      );
      if (sample.length) {
        $('bdGoogleFetchStatus').textContent = `✓ Canlı kaynaktan ${sample.length} rastgele soru hazırlandı!`;
        toast(`${sample.length} rastgele soru çekildi.`);
      } else {
        $('bdGoogleFetchStatus').textContent = '⚠️ İnternet bağlantısını kontrol et, canlı soru alınamadı.';
        toast('Canlı soru alınamadı.');
      }
    };
  }

  function toast(msg) {
    const t = $('errorToast');
    if (!t) return;
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => t.classList.add('hidden'), 3500);
  }

  function firebaseReady() {
    return window.FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey && !FIREBASE_CONFIG.apiKey.includes('BURAYA');
  }

  async function initFirebase() {
    if (!firebaseReady()) {
      throw new Error('Firebase ayarları eksik. firebase-config.js dosyasını doldur.');
    }
    if (!firebase.apps.length) {
      firebase.initializeApp(FIREBASE_CONFIG);
    }
    const cred = await firebase.auth().signInAnonymously();
    uid = cred.user.uid;
  }

  $('createBtn').onclick = () => {
    mode = 'create';
    $('setupTitle').textContent = 'Oda oluştur';
    $('createSettings').classList.remove('hidden');
    $('roomCodeLabel').classList.add('hidden');
    ensureSetupExtras();
    $('bdGameModeBox')?.classList.remove('hidden');
    if ($('gameModeSelect')) $('gameModeSelect').onchange();
    show('setup');
  };

  $('joinBtn').onclick = () => {
    mode = 'join';
    $('setupTitle').textContent = 'Odaya katıl';
    $('createSettings').classList.add('hidden');
    $('roomCodeLabel').classList.remove('hidden');
    ['bdGameModeBox', 'bdGoogleSourceBox'].forEach((id) => {
      if ($(id)) $(id).classList.add('hidden');
    });
    show('setup');
  };

  $('backHome').onclick = () => {
    ensureProfileBadge();
    show('home');
  };

  $('continueBtn').onclick = async () => {
    const name = $('playerName').value.trim();
    if (!name) {
      toast('Oyuncu adını yazmalısın.');
      return;
    }

    try {
      await initFirebase();
      playerId = uid;
      finishingGame = false;
      handledFinishView = false;
      recordedMatchId = null;
      localStreak = 0;
      doublePointsArmed = false;
      activeBetAmount = 0;
      used5050OnTurn = -1;
      hiddenOptionIndices.clear();
      shownPenaltyIds.clear();
      seenReactionIds.clear();
      lastSeenChatCount = 0;
      clearTimeout(turnAdvanceTimer);

      if (mode === 'create') {
        roomId = String(Math.floor(100000 + Math.random() * 900000));
        const gMode = $('gameModeSelect')?.value || 'standard';
        const isPuzzle = gMode === 'number_puzzle';
        const requestedCount = Number($('qCount').value) || 10;

        questionDeck = isPuzzle
          ? []
          : await fetchRandomQuestionsFromWeb(
              requestedCount,
              $('category')?.value || 'Karışık',
              $('difficulty')?.value || 'Karışık'
            );

        if (!isPuzzle && !questionDeck.length) {
          toast('Canlı kaynaktan soru çekilemedi, bağlantını kontrol et.');
          return;
        }

        const qTimeVal = gMode === 'lightning' ? 7 : Number($('qTime').value) || 15;

        const room = {
          createdAt: Date.now(),
          host: uid,
          status: 'lobby',
          settings: {
            count: isPuzzle ? 2 : questionDeck.length,
            time: qTimeVal,
            category: $('category').value,
            difficulty: $('difficulty').value,
            gameMode: gMode
          },
          players: {
            [uid]: {
              name,
              avatar: chosenAvatar,
              tauntSound: wrongSoundStyle,
              ready: false,
              connected: true,
              score: 0,
              correct: 0,
              wrong: 0,
              streak: 0,
              jokers: { fifty: 1, plusTime: 1, doublePts: 1 },
              slot: 1
            }
          },
          questions: questionDeck.map((q) => ({ ...q })),
          turn: 0,
          answers: {},
          tasks: [],
          chat: {},
          reactions: {},
          typing: {},
          sabotage: null,
          predictions: {},
          numberPuzzle: isPuzzle
            ? {
                setterSlot: 1,
                guesserSlot: 2,
                secretNumber: null,
                questionsLeft: 10,
                pendingQuestion: null,
                history: [],
                completedTurns: 0
              }
            : null
        };

        roomRef = firebase.database().ref('rooms/' + roomId);
        await roomRef.set(room);
        mySlot = 1;
      } else {
        roomId = $('roomCode').value.trim();
        if (!/^\d{6}$/.test(roomId)) {
          toast('6 haneli oda kodunu gir.');
          return;
        }

        roomRef = firebase.database().ref('rooms/' + roomId);
        const snap = await roomRef.once('value');
        if (!snap.exists()) {
          toast('Bu oda bulunamadı.');
          return;
        }

        const data = snap.val();
        if (data.status !== 'lobby') {
          toast('Bu oda oyun aşamasında veya tamamlanmış.');
          return;
        }

        const currentPlayers = Object.values(data.players || {});
        if (currentPlayers.length >= 2) {
          await roomRef.child('players/' + uid).set({
            name,
            avatar: chosenAvatar,
            tauntSound: wrongSoundStyle,
            ready: true,
            connected: true,
            spectator: true,
            score: 0,
            correct: 0,
            wrong: 0,
            streak: 0,
            jokers: { fifty: 0, plusTime: 0, doublePts: 0 },
            slot: 3
          });
          mySlot = 3;
          toast('👀 Oda doluydu, İzleyici modunda katıldın!');
        } else {
          saveRecentQuestionKeys(data.questions || []);
          await roomRef.child('players/' + uid).set({
            name,
            avatar: chosenAvatar,
            tauntSound: wrongSoundStyle,
            ready: false,
            connected: true,
            spectator: false,
            score: 0,
            correct: 0,
            wrong: 0,
            streak: 0,
            jokers: { fifty: 1, plusTime: 1, doublePts: 1 },
            slot: 2
          });
          mySlot = 2;
        }
      }

      $('lobbyCode').textContent = roomId;
      ensureChatWidget();
      ensureReactionBar();
      show('lobby');
      listenRoom();
    } catch (e) {
      toast(e.message || 'Bağlantı kurulamadı. Firebase ayarlarını kontrol et.');
      console.error(e);
    }
  };

  function isSpectator() {
    return Boolean(roomData?.players?.[uid]?.spectator || mySlot === 3);
  }

  function isNumberPuzzleMode() {
    return roomData?.settings?.gameMode === 'number_puzzle';
  }

  function isCurrentUserWinner() {
    if (!roomData?.players || !uid) return false;
    const me = roomData.players[uid];
    const rival = Object.values(roomData.players).find((p) => !p.spectator && p.slot !== mySlot);
    if (!me) return false;
    if (!rival) return true;
    const myBase = Number(me.prePenaltyScore ?? me.score ?? 0);
    const rivalBase = Number(rival.prePenaltyScore ?? rival.score ?? 0);
    return myBase > rivalBase;
  }

  function checkRivalDisconnectNotice() {
    if (!roomData?.players || !uid) return;
    const rival = Object.values(roomData.players).find((p) => !p.spectator && p.slot !== mySlot);
    if (rival && rival.connected === false && roomData.status === 'playing') {
      toast(`⚠️ ${rival.name || 'Rakibin'} bağlantısı koptu.`);
    }
  }

  function listenRoom() {
    if (!roomRef) return;
    roomRef.off();

    roomRef.on(
      'value',
      (snap) => {
        if (!snap.exists()) {
          clearInterval(timerInterval);
          clearTimeout(turnAdvanceTimer);
          removeChatWidget();
          removeReactionBar();
          closePenaltyPopup();
          toast('Oda silinmiş.');
          show('home');
          return;
        }
        roomData = snap.val();

        if (roomData.players && roomData.players[uid]) {
          ensureChatWidget();
          ensureReactionBar();
          renderChatMessages();
          updateTypingIndicator();
          checkNewFloatingReactions();
        }

        checkRivalDisconnectNotice();
        checkIncomingPenaltyPopup();

        if (roomData.status === 'lobby') {
          handledFinishView = false;
          recordedMatchId = null;
          shownPenaltyIds.clear();
          renderLobby();
        } else if (roomData.status === 'playing') {
          if (!$('market').classList.contains('hidden')) {
            renderMarket();
            updateGameHudOnly();
          } else if (isNumberPuzzleMode()) {
            renderNumberPuzzleGame();
          } else {
            renderGame();
            scheduleTurnAdvanceIfAnswered();
          }
        } else if (roomData.status === 'finished') {
          clearInterval(timerInterval);
          clearTimeout(turnAdvanceTimer);
          recordMatchStatsOnce();
          const iAmWinner = isCurrentUserWinner();

          if (!handledFinishView) {
            handledFinishView = true;
            if (iAmWinner && !isSpectator()) {
              renderMarket();
              show('market');
              toast('🏆 Tebrikler! Puanın yüksek olduğu için rakibine ceza seçebilirsin.');
            } else {
              renderResult();
              if (!isSpectator()) renderLoserPenaltyBanner();
            }
          } else if (!$('market').classList.contains('hidden') && iAmWinner && !isSpectator()) {
            renderMarket();
          } else {
            renderResult();
            if (!isSpectator() && !iAmWinner) renderLoserPenaltyBanner();
          }
        }
      },
      (err) => toast('Oda güncellenemedi: ' + err.message)
    );

    roomRef.child('players').child(uid).onDisconnect().update({ connected: false });
  }

  function scheduleTurnAdvanceIfAnswered() {
    if (!roomData || roomData.status !== 'playing' || isNumberPuzzleMode()) return;
    const currentTurn = Number(roomData.turn || 0);
    const ansObj = roomData.answers && roomData.answers[currentTurn];
    if (!ansObj) return;

    const canAdvance = ansObj.by === uid || roomData.host === uid;
    if (!canAdvance) return;

    clearTimeout(turnAdvanceTimer);
    turnAdvanceTimer = setTimeout(async () => {
      if (!roomData || roomData.status !== 'playing') return;
      if (Number(roomData.turn || 0) !== currentTurn) return;
      if (!(roomData.answers && roomData.answers[currentTurn])) return;
      await advanceTurnAfterAnswer(currentTurn);
    }, 1600);
  }

  async function advanceTurnAfterAnswer(answeredTurn) {
    if (!roomRef || !roomData || roomData.status !== 'playing') return;
    if (Number(roomData.turn || 0) !== Number(answeredTurn)) return;

    const totalQuestions = (roomData.questions || []).length;
    const nextTurn = Number(answeredTurn) + 1;

    if (nextTurn >= totalQuestions) {
      await finalizeGameWithPenalties();
    } else {
      await roomRef.update({ turn: nextTurn, sabotage: null });
    }
  }

  // --- LOBİDE AYAR GÜNCELLEME, SES SEÇİMİ & İZLEYİCİ TAHMİNİ ---
  function ensureLobbyExtras() {
    const lobbySec = $('lobby');
    if (!lobbySec) return;

    let setBox = $('bdLobbySettingsBox');
    if (!setBox) {
      setBox = document.createElement('div');
      setBox.id = 'bdLobbySettingsBox';
      setBox.style.cssText =
        'margin:12px 0;padding:12px;border-radius:14px;background:#fff;border:1px solid #e5e7eb;display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:space-between;';
      const startBtn = $('startBtn');
      if (startBtn && startBtn.parentNode) {
        startBtn.parentNode.insertBefore(setBox, startBtn);
      } else {
        lobbySec.appendChild(setBox);
      }
    }

    const isHost = roomData?.host === uid;
    const curCount = Number(roomData?.settings?.count || 10);
    const curTime = Number(roomData?.settings?.time || 15);
    const puzzleMode = isNumberPuzzleMode();

    const soundPickerHtml = `
      <label style="font-size:.8rem;">Rakip Hata Sesi:
        <select id="lobbyTauntSelect" style="padding:3px 6px;border-radius:8px;border:1px solid #d1d5db;">
          <option value="laugh" ${wrongSoundStyle === 'laugh' ? 'selected' : ''}>😂 Gülme</option>
          <option value="siren" ${wrongSoundStyle === 'siren' ? 'selected' : ''}>🚨 Siren</option>
          <option value="vinyl" ${wrongSoundStyle === 'vinyl' ? 'selected' : ''}>💿 Bozuk Plak</option>
          <option value="giggle" ${wrongSoundStyle === 'giggle' ? 'selected' : ''}>🤭 Kıkırdama</option>
        </select>
      </label>
    `;

    if (isHost && !puzzleMode) {
      setBox.innerHTML = `
        <span style="font-size:.84rem;font-weight:700;">⚙️ Lobi Ayarı:</span>
        <label style="font-size:.8rem;">Soru:
          <select id="lobbyQCount" style="padding:3px 6px;border-radius:8px;border:1px solid #d1d5db;">
            <option value="5" ${curCount === 5 ? 'selected' : ''}>5</option>
            <option value="10" ${curCount === 10 ? 'selected' : ''}>10</option>
            <option value="15" ${curCount === 15 ? 'selected' : ''}>15</option>
          </select>
        </label>
        <label style="font-size:.8rem;">Süre:
          <select id="lobbyQTime" style="padding:3px 6px;border-radius:8px;border:1px solid #d1d5db;">
            <option value="7" ${curTime === 7 ? 'selected' : ''}>7 sn</option>
            <option value="15" ${curTime === 15 ? 'selected' : ''}>15 sn</option>
            <option value="20" ${curTime === 20 ? 'selected' : ''}>20 sn</option>
          </select>
        </label>
        ${soundPickerHtml}
        <button type="button" id="lobbyApplySettingsBtn" class="btn secondary small">Yeni Sorularla Güncelle</button>
      `;
      $('lobbyApplySettingsBtn').onclick = async () => {
        const newCount = Number($('lobbyQCount').value || 10);
        const newTime = Number($('lobbyQTime').value || 15);
        const fresh = await fetchRandomQuestionsFromWeb(
          newCount,
          roomData?.settings?.category || 'Karışık',
          roomData?.settings?.difficulty || 'Karışık'
        );
        if (!fresh.length) {
          toast('Canlı kaynaktan yeni soru çekilemedi.');
          return;
        }
        await roomRef.update({
          'settings/count': fresh.length,
          'settings/time': newTime,
          questions: fresh.map((q) => ({ ...q }))
        });
        toast('Canlı kaynaktan yeni sorular çekildi ve lobi güncellendi!');
      };
    } else {
      setBox.innerHTML = `
        <small>⚙️ Mod: <b>${puzzleMode ? '🔢 Sayı Bulmaca (Sınırsız Sayı · Soru Sor/Cevapla)' : `${curCount} Soru · ${curTime} sn`}</b></small>
        ${soundPickerHtml}
      `;
    }

    const tauntSel = $('lobbyTauntSelect');
    if (tauntSel) {
      tauntSel.onchange = async (e) => {
        wrongSoundStyle = e.target.value;
        await syncMyTauntSoundToRoom();
        playWrongSound(wrongSoundStyle);
        toast('Rakibin yanlış yapınca çalacak ses ayarlandı!');
      };
    }

    let predBox = $('bdSpectatorPredBox');
    if (!predBox) {
      predBox = document.createElement('div');
      predBox.id = 'bdSpectatorPredBox';
      predBox.style.cssText =
        'margin:10px 0;padding:10px 12px;border-radius:12px;background:#fef3c7;border:1px solid #fcd34d;font-size:.84rem;';
      setBox.parentNode.insertBefore(predBox, setBox.nextSibling);
    }

    const contenders = Object.entries(roomData?.players || {}).filter(([, p]) => !p.spectator);
    if (isSpectator() && contenders.length >= 2) {
      const myPred = roomData?.predictions?.[uid];
      predBox.innerHTML = `
        <b>🔮 İzleyici Tahmini Yap:</b>
        ${contenders
          .map(
            ([pid, p]) =>
              `<button type="button" class="btn secondary small" data-pred="${pid}" style="margin-left:6px;${
                myPred === pid ? 'outline:2px solid #ea580c;' : ''
              }">${escapeHtml(p.avatar)} ${escapeHtml(p.name)}</button>`
          )
          .join('')}
      `;
      predBox.querySelectorAll('[data-pred]').forEach((b) => {
        b.onclick = async () => {
          await roomRef.child('predictions/' + uid).set(b.dataset.pred);
          toast('Tahminin kaydedildi!');
        };
      });
    } else {
      const predList = Object.entries(roomData?.predictions || {});
      predBox.innerHTML = predList.length
        ? '🔮 İzleyici Tahminleri: ' +
          predList
            .map(([, targetPid]) => `<b>${escapeHtml(roomData?.players?.[targetPid]?.name || '?')}</b>`)
            .join(', ')
        : '';
    }
  }

  function renderLobby() {
    clearInterval(timerInterval);
    show('lobby');
    const p = Object.values(roomData.players || {})
      .filter((x) => !x.spectator)
      .sort((a, b) => a.slot - b.slot);

    for (let i = 0; i < 2; i++) {
      const el = $('slot' + (i + 1));
      const x = p[i];
      el.querySelector('.avatar-big').textContent = x ? x.avatar : '❔';
      el.querySelector('b').textContent = x ? x.name : 'Oyuncu ' + (i + 1);
      el.querySelector('span').textContent = x ? (x.ready ? 'Hazır ✓' : 'Hazır değil') : 'Bekleniyor…';
      el.style.borderColor = x && x.ready ? '#26b36b' : '';
    }

    ensureLobbyExtras();

    const both = p.length === 2;
    const allReady = both && p.every((x) => x.ready);
    $('lobbyHint').textContent = both
      ? 'İki oyuncu da odada. Hazır olduğunuzda başlayın!'
      : 'Oda kodunu arkadaşına gönder. İkinci oyuncu bekleniyor.';
    $('readyBtn').classList.toggle('hidden', !both || roomData.status !== 'lobby' || isSpectator());
    $('readyBtn').textContent = roomData.players[uid]?.ready ? 'Hazır durumunu geri al' : 'Hazırım!';
    $('startBtn').classList.toggle('hidden', !(roomData.host === uid && allReady));
  }

  $('readyBtn').onclick = async () => {
    if (!roomData?.players?.[uid]) return;
    const r = !roomData.players[uid].ready;
    await roomRef.child('players/' + uid + '/ready').set(r);
  };

  $('startBtn').onclick = async () => {
    if (roomData?.host !== uid) return;
    handledFinishView = false;
    recordedMatchId = null;

    if (isNumberPuzzleMode()) {
      await roomRef.update({
        status: 'playing',
        turn: 0,
        answers: {},
        sabotage: null,
        startedAt: Date.now(),
        numberPuzzle: {
          setterSlot: 1,
          guesserSlot: 2,
          secretNumber: null,
          questionsLeft: 10,
          pendingQuestion: null,
          history: [],
          completedTurns: 0
        }
      });
    } else {
      await roomRef.update({ status: 'playing', turn: 0, answers: {}, sabotage: null, startedAt: Date.now() });
    }
  };

  $('copyCode').onclick = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      toast('Oda kodu kopyalandı!');
    } catch {
      toast('Oda kodun: ' + roomId);
    }
  };

  $('shareCode').onclick = () => {
    window.open(
      'https://wa.me/?text=' +
        encodeURIComponent('Bilgi Düellosu odama katıl! Oda kodu: ' + roomId + ' — ' + location.href),
      '_blank'
    );
  };

  $('leaveLobby').onclick = async () => {
    clearInterval(timerInterval);
    clearTimeout(turnAdvanceTimer);
    removeChatWidget();
    removeReactionBar();
    closePenaltyPopup();
    if (roomRef) {
      await roomRef.child('players/' + uid).remove();
      if (roomData?.host === uid) await roomRef.remove();
      roomRef.off();
    }
    show('home');
  };

  // --- SAYI BULMACA MODU: SINIRSIZ SAYI + SORU SOR (HAK DÜŞMEZ) + SAYI TAHMİNİ (HAK DÜŞER) ---
  function getPlayerEntryBySlot(slotNum) {
    return (
      Object.entries(roomData?.players || {}).find(
        ([, p]) => !p.spectator && Number(p.slot) === Number(slotNum)
      ) || null
    );
  }

  function parseAnyInteger(raw) {
    const cleaned = String(raw || '').trim().replace(/\s+/g, '');
    if (!/^-?\d+$/.test(cleaned)) return null;
    const num = Number(cleaned);
    return Number.isSafeInteger(num) ? num : null;
  }

  function renderNumberPuzzleGame() {
    clearInterval(timerInterval);
    show('game');
    if (!roomData?.players) return;

    updateGameHudOnly();
    if ($('bdJokerBar')) $('bdJokerBar').classList.add('hidden');

    const np = roomData.numberPuzzle || {
      setterSlot: 1,
      guesserSlot: 2,
      secretNumber: null,
      questionsLeft: 10,
      pendingQuestion: null,
      history: [],
      completedTurns: 0
    };

    const setterEntry = getPlayerEntryBySlot(np.setterSlot);
    const guesserEntry = getPlayerEntryBySlot(np.guesserSlot);
    const setterUid = setterEntry?.[0];
    const guesserUid = guesserEntry?.[0];
    const setterName = setterEntry?.[1]?.name || 'Rakip 1';
    const guesserName = guesserEntry?.[1]?.name || 'Rakip 2';

    const doneTurns = Number(np.completedTurns || 0);
    const leftGuesses = Number(np.questionsLeft ?? 10);
    const pendingQ = np.pendingQuestion || null;
    const histList = Array.isArray(np.history) ? np.history : Object.values(np.history || {});

    $('roundNo').textContent = `Aşama ${Math.min(2, doneTurns + 1)} / 2`;
    $('progressBar').style.width = `${Math.min(100, (doneTurns / 2) * 100)}%`;
    $('timer').textContent = String(leftGuesses);
    $('qCategory').textContent = '🔢 Sayı Bulmaca';
    $('qDifficulty').textContent = `${leftGuesses} Tahmin Hakkı (Soru Hak Düşürmez)`;
    $('answerFeedback').textContent = '';

    const ansEl = $('answers');
    ansEl.innerHTML = '';

    const isSetter = uid === setterUid && !isSpectator();
    const isGuesser = uid === guesserUid && !isSpectator();

    const historyHtml = histList.length
      ? `<div style="grid-column:1/-1;max-height:185px;overflow-y:auto;padding:10px;border-radius:12px;background:rgba(148,163,184,.12);font-size:.84rem;">
          <b style="display:block;margin-bottom:6px;">📜 Geçmiş Sorular, Cevaplar ve Sayı Tahminleri:</b>
          ${histList
            .map((item, idx) => {
              if (item.type === 'guess') {
                return `<div style="margin-bottom:5px;">🎯 <b>#${idx + 1} Sayı Tahmini:</b> ${escapeHtml(
                  String(item.val)
                )} — <span style="font-weight:700;">${escapeHtml(item.resultText)}</span></div>`;
              }
              return `<div style="margin-bottom:5px;">❓ <b>#${idx + 1} Soru (Hak düşmedi):</b> ${escapeHtml(
                item.question
              )} → <span style="font-weight:700;color:#ea580c;">${escapeHtml(
                item.answer || 'Cevap bekleniyor...'
              )}</span></div>`;
            })
            .join('')}
        </div>`
      : '';

    if (np.secretNumber === null || np.secretNumber === undefined) {
      $('turnNotice').textContent = isSetter
        ? 'SIRA SENDE! İstediğin tam sayıyı gir ve kilitle (sınır yok).'
        : `${escapeHtml(setterName)} gizli sayısını belirliyor...`;
      $('questionText').textContent = isSetter
        ? 'İstediğin tam sayıyı yaz ve kilitle (örneğin 350, 1453, -88). Rakibin soru sorup 10 sayı tahmin hakkıyla bulmaya çalışacak!'
        : `${escapeHtml(setterName)} sayıyı kilitlediğinde soru sorup 10 sayı tahmin hakkın başlayacak.`;

      if (isSetter) {
        ansEl.innerHTML = `
          <div style="grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <input id="npSecretInput" type="text" inputmode="numeric" placeholder="İstediğin tam sayıyı yaz (örn: 350)" style="flex:1;min-width:190px;padding:10px 12px;border-radius:10px;border:1px solid #d1d5db;">
            <button type="button" id="npLockSecretBtn" class="btn primary">🔒 Sayıyı Kilitle</button>
          </div>
        `;
        $('npLockSecretBtn').onclick = async () => {
          const secretNum = parseAnyInteger($('npSecretInput').value);
          if (secretNum === null) {
            toast('Geçerli bir tam sayı yaz (ör: 350 veya -15).');
            return;
          }
          await roomRef.child('numberPuzzle').update({
            secretNumber: secretNum,
            questionsLeft: 10,
            pendingQuestion: null,
            history: []
          });
          toast('🔒 Sayı kilitlendi! Rakibin soru sormaya veya sayı tahmin etmeye başlayabilir.');
        };
      }
      return;
    }

    if (pendingQ) {
      $('turnNotice').textContent = isSetter
        ? `❓ ${escapeHtml(guesserName)} SORU SORDU! Cevapla (hak düşmez).`
        : `⏳ Sorun (${escapeHtml(pendingQ.text)}) ${escapeHtml(setterName)} tarafından cevaplanıyor...`;
      $('questionText').textContent = isSetter
        ? `Senin Sayın: ${np.secretNumber} | Gelen Soru: "${pendingQ.text}"`
        : `Sorulan Soru: "${pendingQ.text}" (Cevap bekleniyor — hak düşmez)`;

      if (isSetter) {
        ansEl.innerHTML =
          historyHtml +
          `
          <div style="grid-column:1/-1;display:flex;flex-direction:column;gap:8px;">
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button type="button" id="npAnsYesBtn" class="btn primary small">✅ EVET</button>
              <button type="button" id="npAnsNoBtn" class="btn secondary small">❌ HAYIR</button>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <input id="npCustomAnswerInput" placeholder="Kendi cevabını yaz..." style="flex:1;min-width:170px;padding:9px 12px;border-radius:10px;border:1px solid #d1d5db;">
              <button type="button" id="npSendCustomAnsBtn" class="btn secondary small">Cevabı Gönder</button>
            </div>
          </div>
        `;

        const submitQuestionReply = async (replyText) => {
          const nextHist = [
            ...histList,
            {
              type: 'qa',
              question: pendingQ.text,
              answer: replyText,
              at: Date.now()
            }
          ];

          // Soru cevaplandığında tahmin hakkı düşmez
          await roomRef.child('numberPuzzle').update({
            pendingQuestion: null,
            history: nextHist
          });
          toast('Cevabın gönderildi! (Tahmin hakkı düşmedi)');
        };

        $('npAnsYesBtn').onclick = () => submitQuestionReply('Evet');
        $('npAnsNoBtn').onclick = () => submitQuestionReply('Hayır');
        $('npSendCustomAnsBtn').onclick = () => {
          const txt = ($('npCustomAnswerInput').value || '').trim();
          if (!txt) {
            toast('Bir cevap yazmalısın.');
            return;
          }
          submitQuestionReply(txt);
        };
      } else {
        ansEl.innerHTML = historyHtml;
      }
      return;
    }

    $('turnNotice').textContent = isGuesser
      ? `SIRA SENDE! Soru sor (hak düşmez) veya sayı tahmin et (${leftGuesses} tahmin hakkı kaldı).`
      : isSetter
      ? `Senin Sayın: ${np.secretNumber} | ${escapeHtml(guesserName)} soru soruyor / sayı tahmin ediyor.`
      : `${escapeHtml(guesserName)}, ${escapeHtml(setterName)} tuttuğu sayıyı bulmaya çalışıyor.`;

    $('questionText').textContent = `Gizli sayıyı bul! Kalan sayı tahmin hakkı: ${leftGuesses} / 10 (Soru sormak hak düşürmez)`;

    const actionHtml = isGuesser
      ? `
        <div style="grid-column:1/-1;display:flex;flex-direction:column;gap:10px;">
          <div style="background:rgba(249,115,22,.08);border:1px solid rgba(249,115,22,.28);padding:10px;border-radius:12px;">
            <b style="display:block;margin-bottom:6px;font-size:.86rem;">❓ Rakibine Soru Sor (Hak Düşmez)</b>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
              <input id="npAskQuestionInput" placeholder="Örn: Sayı çift mi? 3 basamaklı mı? Negatif mi?" style="flex:1;min-width:190px;padding:10px 12px;border-radius:10px;border:1px solid #d1d5db;">
              <button type="button" id="npAskQuestionBtn" class="btn primary small">❓ Soru Sor</button>
            </div>
          </div>
          <div style="background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.28);padding:10px;border-radius:12px;">
            <b style="display:block;margin-bottom:6px;font-size:.86rem;">🎯 Sayı Tahmini Gir (1 Hak Düşer)</b>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
              <input id="npGuessInput" type="text" inputmode="numeric" placeholder="Tahmin ettiğin sayıyı yaz..." style="flex:1;min-width:160px;padding:10px 12px;border-radius:10px;border:1px solid #d1d5db;">
              <button type="button" id="npAskGuessBtn" class="btn secondary small">🎯 Sayıyı Tahmin Et</button>
            </div>
          </div>
        </div>
      `
      : `<div style="grid-column:1/-1;font-size:.86rem;color:#64748b;">Rakibin soru sorup sayıyı bulmaya çalışıyor...</div>`;

    ansEl.innerHTML = historyHtml + actionHtml;

    if (isGuesser && $('npAskQuestionBtn')) {
      $('npAskQuestionBtn').onclick = async () => {
        const qText = ($('npAskQuestionInput').value || '').trim();
        if (!qText) {
          toast('Soracağın soruyu yazmalısın.');
          return;
        }
        await roomRef.child('numberPuzzle/pendingQuestion').set({
          text: qText,
          askedBy: uid,
          at: Date.now()
        });
        toast('❓ Sorun gönderildi! Rakibinin cevabı bekleniyor...');
      };
    }

    if (isGuesser && $('npAskGuessBtn')) {
      $('npAskGuessBtn').onclick = async () => {
        const gVal = parseAnyInteger($('npGuessInput').value);
        if (gVal === null) {
          toast('Geçerli bir tam sayı tahmini yaz.');
          return;
        }
        const secret = Number(np.secretNumber);
        const nextLeft = Math.max(0, leftGuesses - 1);
        const nextHist = [...histList];

        if (gVal === secret) {
          playCorrectSound();
          nextHist.push({ type: 'guess', val: gVal, resultText: '🎉 Doğru sayı!' });
          const earned = 40 + nextLeft * 5;
          const myCurScore = Number(roomData.players?.[uid]?.score || 0);
          const myCurCorrect = Number(roomData.players?.[uid]?.correct || 0);
          await roomRef.child(`players/${uid}`).update({
            score: myCurScore + earned,
            correct: myCurCorrect + 1
          });

          const nextDone = doneTurns + 1;
          if (nextDone >= 2) {
            await roomRef.child('numberPuzzle').update({
              questionsLeft: nextLeft,
              pendingQuestion: null,
              history: nextHist,
              completedTurns: nextDone
            });
            toast(`🎉 Sayıyı bildin (+${earned}p)! Oyun bitiyor...`);
            setTimeout(() => finalizeGameWithPenalties(), 1200);
          } else {
            await roomRef.child('numberPuzzle').update({
              setterSlot: np.guesserSlot,
              guesserSlot: np.setterSlot,
              secretNumber: null,
              questionsLeft: 10,
              pendingQuestion: null,
              history: [],
              completedTurns: nextDone
            });
            toast(`🎉 Bildin (+${earned}p)! Sıra diğer rakibe geçti.`);
          }
          return;
        }

        playWrongSound(getRivalTauntSoundStyle());
        nextHist.push({ type: 'guess', val: gVal, resultText: 'Yanlış tahmin' });

        if (nextLeft <= 0) {
          const nextDone = doneTurns + 1;
          if (setterUid) {
            const setterScore = Number(roomData.players?.[setterUid]?.score || 0);
            await roomRef.child(`players/${setterUid}/score`).set(setterScore + 30);
          }
          nextHist.push({ type: 'guess', val: secret, resultText: '❌ 10 tahmin hakkı bitti (Gizli sayı)' });

          if (nextDone >= 2) {
            await roomRef.child('numberPuzzle').update({
              questionsLeft: 0,
              pendingQuestion: null,
              history: nextHist,
              completedTurns: nextDone
            });
            toast('❌ 10 tahmin hakkı doldu. Oyun bitiyor...');
            setTimeout(() => finalizeGameWithPenalties(), 1300);
          } else {
            await roomRef.child('numberPuzzle').update({
              setterSlot: np.guesserSlot,
              guesserSlot: np.setterSlot,
              secretNumber: null,
              questionsLeft: 10,
              pendingQuestion: null,
              history: [],
              completedTurns: nextDone
            });
            toast('❌ 10 tahmin hakkı doldu. Sıra diğer rakibe geçti!');
          }
        } else {
          await roomRef.child('numberPuzzle').update({
            questionsLeft: nextLeft,
            history: nextHist
          });
        }
      };
    }
  }

  // --- JOKER, İDDİA, SABOTAJ & SORU ATLA ---
  async function spendJokerPoints(cost) {
    if (!roomRef || !uid) return false;
    let ok = false;
    await roomRef.transaction((data) => {
      if (!data?.players?.[uid]) return;
      const cur = Number(data.players[uid].score || 0);
      if (cur < cost) return;
      data.players[uid].score = Math.max(0, cur - cost);
      ok = true;
      return data;
    });
    return ok;
  }

  function ensureJokerAndActionBar(turn, isMyTurn, questionObj) {
    const gameSec = $('game');
    const ansEl = $('answers');
    if (!gameSec || !ansEl) return;

    let bar = $('bdJokerBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'bdJokerBar';
      bar.style.cssText =
        'display:flex;gap:6px;flex-wrap:wrap;margin:10px 0;align-items:center;justify-content:space-between;';
      ansEl.parentNode.insertBefore(bar, ansEl);
    }
    bar.classList.remove('hidden');

    const me = roomData?.players?.[uid] || {};
    const jokers = me.jokers || { fifty: 1, plusTime: 1, doublePts: 1 };
    const disabledAll = !isMyTurn || answered || isSpectator();
    const myScore = Number(me.score || 0);

    bar.innerHTML = `
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
        <button type="button" id="joker5050Btn" class="btn secondary small" ${
          disabledAll || (jokers.fifty || 0) <= 0 || used5050OnTurn === turn || myScore < JOKER_COSTS.fifty ? 'disabled' : ''
        }>✂️ 50/50 (-${JOKER_COSTS.fifty}p)</button>
        <button type="button" id="jokerTimeBtn" class="btn secondary small" ${
          disabledAll || (jokers.plusTime || 0) <= 0 || myScore < JOKER_COSTS.plusTime ? 'disabled' : ''
        }>⏱️ +10 sn (-${JOKER_COSTS.plusTime}p)</button>
        <button type="button" id="joker2xBtn" class="btn secondary small" ${
          disabledAll || (jokers.doublePts || 0) <= 0 || doublePointsArmed || myScore < JOKER_COSTS.doublePts ? 'disabled' : ''
        }>⚡ 2x (-${JOKER_COSTS.doublePts}p)</button>
        <select id="bdBetSelect" ${disabledAll ? 'disabled' : ''} style="padding:4px 8px;border-radius:8px;border:1px solid #d1d5db;font-size:.78rem;">
          <option value="0" ${activeBetAmount === 0 ? 'selected' : ''}>🎲 İddia Yok</option>
          <option value="15" ${activeBetAmount === 15 ? 'selected' : ''} ${myScore < 15 ? 'disabled' : ''}>🎲 +15p İddia</option>
          <option value="30" ${activeBetAmount === 30 ? 'selected' : ''} ${myScore < 30 ? 'disabled' : ''}>🎲 +30p İddia</option>
        </select>
        <button type="button" id="bdSabotageBtn" class="btn secondary small" ${
          answered || isSpectator() || myScore < JOKER_COSTS.sabotage || roomData?.sabotage?.turn === turn ? 'disabled' : ''
        }>😈 Sabotaj (-${JOKER_COSTS.sabotage}p)</button>
        <button type="button" id="bdSkipQBtn" class="btn secondary small" ${
          disabledAll ? 'disabled' : ''
        }>⏭️ Atla</button>
      </div>
      <span id="bdStreakBadge" style="font-size:.82rem;font-weight:800;color:#ea580c;">${
        localStreak >= 2 ? `🔥 ${localStreak}x Seri!` : doublePointsArmed ? '⚡ 2x Aktif!' : ''
      }</span>
    `;

    const b50 = $('joker5050Btn');
    if (b50) {
      b50.onclick = async () => {
        if (!questionObj || used5050OnTurn === turn) return;
        const paid = await spendJokerPoints(JOKER_COSTS.fifty);
        if (!paid) {
          toast('50/50 için yeterli puanın yok!');
          return;
        }
        const wrongIndices = [0, 1, 2, 3].filter((idx) => idx !== questionObj.k);
        const toHide = fisherYatesShuffle(wrongIndices).slice(0, 2);
        used5050OnTurn = turn;
        toHide.forEach((idx) => hiddenOptionIndices.add(idx));
        await roomRef.child(`players/${uid}/jokers/fifty`).set(Math.max(0, (jokers.fifty || 1) - 1));
        playTone(680, 0.1, 'triangle', 0.2);
        toast(`✂️ -${JOKER_COSTS.fifty} puan silindi, 2 şık elendi!`);
        renderGame();
      };
    }

    const bTime = $('jokerTimeBtn');
    if (bTime) {
      bTime.onclick = async () => {
        const paid = await spendJokerPoints(JOKER_COSTS.plusTime);
        if (!paid) {
          toast('+10 sn için yeterli puanın yok!');
          return;
        }
        localTimer += 10;
        if ($('timer')) $('timer').textContent = localTimer;
        await roomRef.child(`players/${uid}/jokers/plusTime`).set(Math.max(0, (jokers.plusTime || 1) - 1));
        playTone(760, 0.12, 'triangle', 0.22);
        toast(`⏱️ -${JOKER_COSTS.plusTime} puan silindi, +10 saniye eklendi!`);
        renderGame();
      };
    }

    const b2x = $('joker2xBtn');
    if (b2x) {
      b2x.onclick = async () => {
        const paid = await spendJokerPoints(JOKER_COSTS.doublePts);
        if (!paid) {
          toast('2x bonus için yeterli puanın yok!');
          return;
        }
        doublePointsArmed = true;
        await roomRef.child(`players/${uid}/jokers/doublePts`).set(Math.max(0, (jokers.doublePts || 1) - 1));
        playTone(880, 0.14, 'triangle', 0.24);
        toast(`⚡ -${JOKER_COSTS.doublePts} puan silindi, bu soruda 2x puan aktif!`);
        renderGame();
      };
    }

    const betSel = $('bdBetSelect');
    if (betSel) {
      betSel.onchange = (e) => {
        activeBetAmount = Number(e.target.value || 0);
        toast(activeBetAmount > 0 ? `🎲 ${activeBetAmount} puan iddia koydun!` : 'İddia iptal edildi.');
      };
    }

    const sabBtn = $('bdSabotageBtn');
    if (sabBtn) {
      sabBtn.onclick = async () => {
        const wrongChoices = [0, 1, 2, 3].filter((idx) => idx !== questionObj?.k);
        const trapIdx = wrongChoices[Math.floor(Math.random() * wrongChoices.length)] ?? 0;
        await roomRef.transaction((data) => {
          if (!data?.players?.[uid]) return;
          const cur = Number(data.players[uid].score || 0);
          if (cur < JOKER_COSTS.sabotage) return;
          data.players[uid].score = Math.max(0, cur - JOKER_COSTS.sabotage);
          data.sabotage = {
            turn,
            trapIndex: trapIdx,
            by: uid,
            byName: data.players[uid].name || 'Rakip'
          };
          return data;
        });
        toast(`😈 -${JOKER_COSTS.sabotage} puan silindi, rakibin şıkları şaşırtıldı!`);
      };
    }

    const skipBtn = $('bdSkipQBtn');
    if (skipBtn) {
      skipBtn.onclick = () => submitAnswer(-1, true, turn);
    }
  }

  function updateGameHudOnly() {
    if (!roomData?.players) return;
    const players = Object.values(roomData.players)
      .filter((p) => !p.spectator)
      .sort((a, b) => a.slot - b.slot);
    const me = roomData.players[uid];
    const rival = players.find((x) => x.slot !== mySlot);

    const turn = Number(roomData.turn || 0);
    const qs = Array.isArray(roomData.questions) ? roomData.questions : [];
    const curQ = qs[turn];
    const hideScores = !isNumberPuzzleMode() && curQ?.twist === 'blind' && !answered;

    $('meLabel').textContent = me?.name || 'Sen';
    $('rivalLabel').textContent = rival?.name || 'Rakip';
    $('myScore').textContent = hideScores ? '???' : me?.score || 0;
    $('rivalScore').textContent = hideScores ? '???' : rival?.score || 0;
  }

  function renderGame() {
    clearInterval(timerInterval);
    show('game');
    if (!roomData?.players) return;

    updateGameHudOnly();
    const turn = Number(roomData.turn || 0);
    if (used5050OnTurn !== turn) {
      hiddenOptionIndices.clear();
      activeBetAmount = 0;
    }

    const qs = Array.isArray(roomData.questions) ? roomData.questions : [];
    if (!qs.length || turn >= qs.length) {
      if (roomData.host === uid) finalizeGameWithPenalties();
      return;
    }

    $('roundNo').textContent = turn + 1 + ' / ' + qs.length;
    $('progressBar').style.width = (turn / qs.length) * 100 + '%';

    const activeSlot = (turn % 2) + 1;
    const isMyTurn = activeSlot === mySlot && !isSpectator();
    const sab = roomData.sabotage && Number(roomData.sabotage.turn) === turn ? roomData.sabotage : null;

    if (isSpectator()) {
      $('turnNotice').textContent = '👀 İzleyici Modundasın — Maçı canlı takip ediyorsun.';
    } else if (isMyTurn) {
      $('turnNotice').textContent = sab
        ? `😈 DİKKAT! ${escapeHtml(sab.byName || 'Rakibin')} şıkları şaşırttı — Cevabını seç!`
        : 'SIRA SENDE! Cevabını seç.';
    } else {
      $('turnNotice').textContent = 'Rakibin cevap veriyor, bekle!';
    }
    $('turnNotice').style.background = sab && isMyTurn ? '#fee2e2' : isMyTurn ? '#fff2e7' : '#edf4ff';
    $('turnNotice').style.color = sab && isMyTurn ? '#b91c1c' : isMyTurn ? '#d65f10' : '#3769cc';

    const gameCard = $('game')?.querySelector('.card') || $('game');
    if (gameCard && gameCard.classList) {
      gameCard.classList.toggle('bd-active-turn-glow', isMyTurn);
    }

    selectedQuestion = qs[turn];
    if (!selectedQuestion) {
      if (roomData.host === uid) finalizeGameWithPenalties();
      return;
    }

    const twist = selectedQuestion.twist || 'normal';
    const twistLabel =
      twist === 'reverse'
        ? ' 🙃 TERS KÖŞE: YANLIŞ ŞIKKI SEÇ!'
        : twist === 'blind'
        ? ' 🙈 GİZLİ PUAN TURU'
        : twist === 'bomb'
        ? ' 💣 SICAK PATATES BOMBA!'
        : '';

    $('qCategory').textContent = (selectedQuestion.c || 'Genel') + twistLabel;
    $('qDifficulty').textContent = selectedQuestion.d || 'Orta';
    $('questionText').textContent =
      twist === 'reverse'
        ? `${selectedQuestion.q || ''} (Dikkat: YANLIŞ olan şıkkı bul!)`
        : selectedQuestion.q || '';

    const answersMap = roomData.answers || {};
    const turnAnswer = answersMap[turn];
    answered = Boolean(turnAnswer);

    ensureJokerAndActionBar(turn, isMyTurn, selectedQuestion);

    const ans = $('answers');
    ans.innerHTML = '';

    (selectedQuestion.a || []).forEach((text, i) => {
      const b = document.createElement('button');
      b.className = 'answer';
      const showTrapHint = sab && sab.trapIndex === i && !turnAnswer && isMyTurn;
      const hintTag = showTrapHint ? ' 😈 (Şüpheli Tuzak Şık!)' : '';
      b.textContent = ['A', 'B', 'C', 'D'][i] + '. ' + text + hintTag;

      if (showTrapHint) {
        b.style.borderStyle = 'dashed';
        b.style.borderColor = '#ef4444';
      }
      if (hiddenOptionIndices.has(i) && !turnAnswer) {
        b.style.visibility = 'hidden';
        b.disabled = true;
      } else {
        b.disabled = !isMyTurn || answered;
      }
      b.onclick = () => submitAnswer(i, false, turn);
      ans.appendChild(b);
    });

    if (turnAnswer) {
      $('answerFeedback').textContent = turnAnswer.explanation || '';
      if (turnAnswer.correctIndex !== undefined) {
        [...ans.children].forEach((b, i) => {
          if (i === turnAnswer.correctIndex) b.classList.add('correct');
          if (i === turnAnswer.choice && i !== turnAnswer.correctIndex) b.classList.add('wrong');
        });
      }
    } else {
      $('answerFeedback').textContent = '';
    }

    if (isMyTurn && !answered) {
      startTimer(localTimer > 0 && used5050OnTurn === turn ? localTimer : Number(roomData.settings?.time || 15), turn);
    }
  }

  function startTimer(seconds, turn) {
    clearInterval(timerInterval);
    localTimer = seconds;
    $('timer').textContent = localTimer;
    const isBomb = selectedQuestion?.twist === 'bomb';

    timerInterval = setInterval(() => {
      localTimer--;
      $('timer').textContent = Math.max(0, localTimer);
      if (isBomb && $('game')) {
        $('game').classList.toggle('bd-bomb-danger', localTimer <= 5 && localTimer > 0);
      }
      if (localTimer > 0 && localTimer <= 3) {
        playTone(760, 0.07, 'sine', 0.16);
      }
      if (localTimer <= 0) {
        clearInterval(timerInterval);
        if ($('game')) $('game').classList.remove('bd-bomb-danger');
        if (roomData && Number(roomData.turn || 0) === turn && !(roomData.answers && roomData.answers[turn])) {
          submitAnswer(-1, true, turn);
        }
      }
    }, 1000);
  }

  async function submitAnswer(choice, timeout = false, turnAtSubmit = null) {
    if (answered || isSpectator() || !roomData || !selectedQuestion || !roomRef) return;
    const currentTurn = turnAtSubmit !== null ? Number(turnAtSubmit) : Number(roomData.turn || 0);
    if (roomData.answers && roomData.answers[currentTurn]) return;

    answered = true;
    clearInterval(timerInterval);
    if ($('game')) $('game').classList.remove('bd-bomb-danger');

    const ansButtons = $('answers') ? [...$('answers').children] : [];
    const q = selectedQuestion;
    const isReverse = q.twist === 'reverse';
    const isBomb = q.twist === 'bomb';
    const correct = !timeout && (isReverse ? choice >= 0 && choice !== q.k : choice === q.k);

    ansButtons.forEach((btn, idx) => {
      btn.disabled = true;
      if (idx === q.k && !isReverse) btn.classList.add('correct');
      if (idx === choice && !correct) btn.classList.add('wrong');
    });

    if (correct) {
      localStreak += 1;
      playCorrectSound();
    } else {
      localStreak = 0;
      playWrongSound(getRivalTauntSoundStyle());
    }

    const me = roomData.players[uid] || {};
    const base = q.d === 'Zor' ? 30 : q.d === 'Orta' ? 20 : 10;
    let bonus = 0;
    if (correct && !timeout) {
      if (localTimer > 10) bonus += 10;
      else if (localTimer > 5) bonus += 5;
      if (localStreak >= 2) bonus += localStreak * 5;
    }

    const rawEarned = correct ? base + bonus : 0;
    const doubled = correct && doublePointsArmed ? rawEarned * 2 : rawEarned;
    doublePointsArmed = false;

    const betDelta = activeBetAmount > 0 ? (correct ? activeBetAmount : -activeBetAmount) : 0;
    const bombPenalty = isBomb && timeout ? -15 : 0;
    activeBetAmount = 0;

    const finalDelta = doubled + betDelta + bombPenalty;
    const newScore = Math.max(0, Number(me.score || 0) + finalDelta);

    const answerObj = {
      choice,
      correct,
      correctIndex: q.k,
      earned: finalDelta,
      explanation: q.e || '',
      by: uid,
      byName: me.name || 'Oyuncu',
      at: Date.now()
    };

    const updates = {};
    updates['answers/' + currentTurn] = answerObj;
    updates['players/' + uid + '/score'] = newScore;
    updates['players/' + uid + '/streak'] = localStreak;
    updates['players/' + uid + '/' + (correct ? 'correct' : 'wrong')] = (me[correct ? 'correct' : 'wrong'] || 0) + 1;

    await roomRef.update(updates);
    scheduleTurnAdvanceIfAnswered();
  }

  // --- MARKET (CEZALAR + ÖZEL CEZA + VETO) ---
  const MARKET_ITEMS = [
    { name: 'Robot gibi konuş', desc: '30 saniye boyunca robot sesini taklit et.', cost: 50, penalty: 15, durationSec: 30, emoji: '🤖' },
    { name: 'Reklam sunucusu', desc: '30 saniye boyunca komik bir ürün tanıtımı yap.', cost: 60, penalty: 20, durationSec: 30, emoji: '📺' },
    { name: 'Hayvan taklidi', desc: 'Rakibinin seçtiği bir hayvanı 15 saniye taklit et.', cost: 70, penalty: 25, durationSec: 15, emoji: '🐒' },
    { name: '5 şehir say', desc: '10 saniye içinde 5 farklı şehir say.', cost: 80, penalty: 30, durationSec: 10, emoji: '🌍' },
    { name: 'Komik dans', desc: '20 saniye boyunca komik bir dans gösterisi yap.', cost: 100, penalty: 40, durationSec: 20, emoji: '💃' },
    { name: 'Şarkı söyle', desc: 'Rakibinin seçtiği şarkıdan bir nakarat söyle.', cost: 120, penalty: 50, durationSec: 25, emoji: '🎤' },
    { name: 'Stand-up', desc: '1 dakika içinde kısa bir espri gösterisi yap.', cost: 150, penalty: 65, durationSec: 60, emoji: '🎙️' },
    { name: 'Gece yarısı itirafı', desc: 'Son 24 saatte yaptığın en komik veya utandırıcı şeyi anlat.', cost: 90, penalty: 35, durationSec: 30, emoji: '🤫' },
    { name: 'Tek kelimelik mesaj', desc: 'Rehberindeki 3. kişiye sadece tek bir emoji veya kelime yaz.', cost: 110, penalty: 45, durationSec: 20, emoji: '📲' }
  ];

  function ensureMarketResultAction() {
    const marketSec = $('market');
    if (!marketSec) return;

    let bar = $('marketFinishBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'marketFinishBar';
      bar.style.cssText =
        'display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin:10px 0;padding:12px 14px;border-radius:14px;background:linear-gradient(135deg,#fff7ed,#ffedd5);border:1px solid #fdba74;';
      const info = document.createElement('span');
      info.id = 'marketStatusBanner';
      info.style.cssText = 'font-weight:700;color:#9a3412;font-size:.92rem;';
      const btn = document.createElement('button');
      btn.id = 'goResultFromMarketBtn';
      btn.type = 'button';
      btn.className = 'btn primary small';
      btn.textContent = '🏆 Sonuç Ekranına Geç';
      btn.onclick = () => renderResult();
      bar.appendChild(info);
      bar.appendChild(btn);
      const balanceEl = $('marketBalance');
      if (balanceEl && balanceEl.parentNode) {
        balanceEl.parentNode.insertBefore(bar, balanceEl.nextSibling);
      } else {
        marketSec.appendChild(bar);
      }
    }

    let customBox = $('customPenaltyBox');
    if (!customBox) {
      customBox = document.createElement('div');
      customBox.id = 'customPenaltyBox';
      customBox.style.cssText =
        'margin:12px 0;padding:14px;border-radius:16px;background:#fff;border:1px solid #e5e7eb;box-shadow:0 4px 14px rgba(0,0,0,.04);';
      customBox.innerHTML = `
        <b style="display:block;margin-bottom:8px;">✍️ Özel Ceza / Görev Yaz (75 Puan · -25 Ceza Puanı)</b>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <input id="customPenaltyInput" maxlength="90" placeholder="Örn: 20 sn fısıldayarak konuş..." style="flex:1;min-width:180px;padding:9px 12px;border-radius:10px;border:1px solid #d1d5db;">
          <button type="button" id="customPenaltySendBtn" class="btn secondary small">Özel Ceza Gönder</button>
        </div>
      `;
      const itemsEl = $('marketItems');
      if (itemsEl && itemsEl.parentNode) {
        itemsEl.parentNode.insertBefore(customBox, itemsEl);
      }
    }

    const banner = $('marketStatusBanner');
    const goResBtn = $('goResultFromMarketBtn');
    const isFinished = roomData?.status === 'finished';
    if (banner) {
      banner.textContent = isFinished
        ? '🏆 Düello Kazananı Sensin! Hazır veya özel ceza gönderebilirsin.'
        : '⚡ Oyun Devam Ediyor! Aldığın cezalar oyun bitince rakibine gider.';
    }
    if (goResBtn) {
      goResBtn.classList.toggle('hidden', !isFinished);
    }

    const sendCustomBtn = $('customPenaltySendBtn');
    const inp = $('customPenaltyInput');
    const me = roomData?.players?.[uid];
    const target = Object.values(roomData?.players || {}).find((x) => !x.spectator && x.slot !== mySlot);
    const canShop = !isSpectator() && (roomData?.status === 'playing' || (isFinished && isCurrentUserWinner()));
    if (sendCustomBtn && inp) {
      sendCustomBtn.disabled = !target || (me?.score || 0) < 75 || !canShop;
      sendCustomBtn.onclick = async () => {
        const text = inp.value.trim();
        if (!text) {
          toast('Özel ceza metni yazmalısın.');
          return;
        }
        inp.value = '';
        await sendCustomPenalty(text);
      };
    }
  }

  function renderMarket() {
    if (!roomData?.players) return;
    ensureMarketResultAction();

    const me = roomData.players[uid];
    const players = Object.values(roomData.players).filter((x) => !x.spectator);
    const target = players.find((x) => x.slot !== mySlot);
    const myPoints = me?.score || 0;
    const isFinished = roomData.status === 'finished';
    const canShop = !isSpectator() && (roomData.status === 'playing' || (isFinished && isCurrentUserWinner()));

    $('marketBalance').textContent = 'Bakiyen: ' + myPoints + ' puan';

    $('marketItems').innerHTML = MARKET_ITEMS.map(
      (x, i) => `
      <div class="market-item" style="border-radius:16px;padding:14px;border:1px solid rgba(0,0,0,.08);background:#fff;box-shadow:0 4px 14px rgba(0,0,0,.04);display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <b style="font-size:1.05rem;">${x.emoji} ${escapeHtml(x.name)}</b>
          <span style="background:#fee2e2;color:#b91c1c;padding:3px 9px;border-radius:999px;font-size:.78rem;font-weight:800;">-${x.penalty} Puan</span>
        </div>
        <small style="color:#555;line-height:1.4;">${escapeHtml(x.desc)}</small>
        <button class="btn primary small" data-buy="${i}" ${!target || myPoints < x.cost || !canShop ? 'disabled' : ''}>
          ${x.cost} puanla ceza ver
        </button>
      </div>`
    ).join('');

    $('marketItems').querySelectorAll('[data-buy]').forEach((b) => {
      b.onclick = () => buyTask(Number(b.dataset.buy));
    });

    const tasks = Array.isArray(roomData.tasks) ? roomData.tasks : Object.values(roomData.tasks || {});
    const relevant = tasks.filter((t) => t && (t.target === uid || t.sender === uid));

    $('taskList').innerHTML = relevant.length
      ? relevant
          .map((t) => {
            const isTargetMe = t.target === uid;
            const senderName = roomData.players[t.sender]?.name || 'Rakip';
            const targetName = roomData.players[t.target]?.name || 'Rakip';
            const statusText =
              t.status === 'vetoed' ? '🚫 Veto Edildi' : t.status === 'done' ? 'Tamamlandı ✓' : 'Bekliyor';
            return `
            <div class="task-card" style="border-radius:16px;padding:14px;margin-bottom:10px;border:2px solid ${
              isTargetMe ? '#ef4444' : '#f59e0b'
            };background:${isTargetMe ? 'linear-gradient(135deg,#fef2f2,#fee2e2)' : '#fffbeb'};">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
                <span style="font-size:.75rem;font-weight:800;padding:4px 10px;border-radius:999px;background:${
                  isTargetMe ? '#dc2626' : '#f59e0b'
                };color:#fff;">
                  ${isTargetMe ? `🎯 SANA VERİLEN CEZA (${escapeHtml(senderName)})` : `📤 ${escapeHtml(targetName)} KİŞİSİNE VERİLDİ`}
                </span>
                <span style="font-weight:800;color:#b91c1c;">-${t.penalty || 0} Puan</span>
              </div>
              <h4 style="margin:8px 0 4px;font-size:1.05rem;">${t.emoji || '🎭'} ${escapeHtml(t.name)}</h4>
              <p style="margin:0 0 8px;color:#374151;">${escapeHtml(t.desc)}</p>
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
                <small style="color:#4b5563;font-weight:600;">
                  ${t.applied ? '✓ Puan cezası uygulandı' : '⏳ Oyun sonunda uygulanacak'} · ${statusText}
                </small>
                ${
                  isTargetMe && t.status !== 'done' && t.status !== 'vetoed'
                    ? `<div style="display:flex;gap:6px;">
                        <button class="btn secondary small" data-done="${escapeHtml(t.id)}">Görevi Tamamladım</button>
                        <button class="btn secondary small" data-veto="${escapeHtml(t.id)}">🚫 40p Veto Et</button>
                       </div>`
                    : ''
                }
              </div>
            </div>`;
          })
          .join('')
      : '<p class="note">Henüz ceza veya görev yok.</p>';

    $('taskList').querySelectorAll('[data-done]').forEach((b) => {
      b.onclick = () => completeTask(b.dataset.done);
    });
    $('taskList').querySelectorAll('[data-veto]').forEach((b) => {
      b.onclick = () => vetoTask(b.dataset.veto);
    });
  }

  async function vetoTask(taskId) {
    const vetoCost = 40;
    const me = roomData?.players?.[uid];
    if (!me || (me.score || 0) < vetoCost) {
      toast('Veto için en az 40 puanın olmalı.');
      return;
    }

    try {
      await roomRef.transaction((data) => {
        if (!data?.players?.[uid]) return;
        if ((data.players[uid].score || 0) < vetoCost) return;
        const tasks = Array.isArray(data.tasks) ? data.tasks : Object.values(data.tasks || {});
        const t = tasks.find((x) => x && x.id === taskId);
        if (!t || t.status === 'vetoed') return;

        data.players[uid].score = (data.players[uid].score || 0) - vetoCost;
        if (t.applied) {
          data.players[uid].score = (data.players[uid].score || 0) + Number(t.penalty || 0);
          t.applied = false;
        }
        t.status = 'vetoed';
        data.tasks = tasks;
        return data;
      });
      toast('🚫 Ceza veto edildi ve ceza puanı iade alındı!');
    } catch {
      toast('Veto işlemi başarısız.');
    }
  }

  async function sendCustomPenalty(customDesc) {
    const cost = 75;
    const penalty = 25;
    const me = roomData?.players?.[uid];
    const targetEntry = Object.entries(roomData?.players || {}).find(([, val]) => !val.spectator && val.slot !== mySlot);
    if (!me || !targetEntry || (me.score || 0) < cost) {
      toast('Özel ceza için yeterli puanın yok.');
      return;
    }

    const targetUid = targetEntry[0];
    const isFinished = roomData.status === 'finished';
    const task = {
      id: Date.now() + '_' + uid.slice(0, 5) + '_' + Math.random().toString(36).slice(2, 6),
      name: 'Özel Ceza',
      desc: customDesc,
      emoji: '✍️',
      cost,
      penalty,
      durationSec: 20,
      sender: uid,
      target: targetUid,
      status: 'pending',
      applied: isFinished,
      createdAt: Date.now()
    };

    try {
      await roomRef.transaction((data) => {
        if (!data || !data.players || !data.players[uid]) return;
        if ((data.players[uid].score || 0) < cost) return;
        data.players[uid].score = (data.players[uid].score || 0) - cost;
        if (data.status === 'finished' && data.players[targetUid]) {
          data.players[targetUid].score = Math.max(0, Number(data.players[targetUid].score || 0) - penalty);
          task.applied = true;
        }
        if (!Array.isArray(data.tasks)) {
          data.tasks = data.tasks ? Object.values(data.tasks) : [];
        }
        data.tasks.push(task);
        return data;
      });
      toast('✍️ Özel ceza rakibine gönderildi!');
    } catch {
      toast('Özel ceza gönderilemedi.');
    }
  }

  async function buyTask(index) {
    if (!roomRef || !roomData || isSpectator()) return;
    const isFinished = roomData.status === 'finished';
    if (roomData.status !== 'playing' && !(isFinished && isCurrentUserWinner())) return;

    const item = MARKET_ITEMS[index];
    const me = roomData.players[uid];
    const targetEntry = Object.entries(roomData.players || {}).find(([, val]) => !val.spectator && val.slot !== mySlot);

    if (!item || !me || !targetEntry) {
      toast('Rakip bulunamadı.');
      return;
    }

    if ((me.score || 0) < item.cost) {
      toast('Bu ceza için yeterli puanın yok.');
      return;
    }

    const targetUid = targetEntry[0];
    const task = {
      id: Date.now() + '_' + uid.slice(0, 5) + '_' + Math.random().toString(36).slice(2, 6),
      name: item.name,
      desc: item.desc,
      emoji: item.emoji,
      cost: item.cost,
      penalty: item.penalty || 0,
      durationSec: item.durationSec || 20,
      sender: uid,
      target: targetUid,
      status: 'pending',
      applied: isFinished,
      createdAt: Date.now()
    };

    try {
      await roomRef.transaction((data) => {
        if (!data || !data.players || !data.players[uid]) return;
        if ((data.players[uid].score || 0) < item.cost) return;
        data.players[uid].score = (data.players[uid].score || 0) - item.cost;

        if (data.status === 'finished' && data.players[targetUid]) {
          const pen = Number(item.penalty || 0);
          data.players[targetUid].score = Math.max(0, Number(data.players[targetUid].score || 0) - pen);
          task.applied = true;
        }

        if (!Array.isArray(data.tasks)) {
          data.tasks = data.tasks ? Object.values(data.tasks) : [];
        }
        data.tasks.push(task);
        return data;
      });
      toast('🎯 Ceza rakibine gönderildi!');
    } catch (e) {
      console.error(e);
      toast('İşlem tamamlanamadı.');
    }
  }

  async function completeTask(id) {
    const snap = await roomRef.child('tasks').once('value');
    const raw = snap.val() || [];
    const tasks = Array.isArray(raw) ? raw : Object.values(raw);
    const idx = tasks.findIndex((t) => t && t.id === id);
    if (idx < 0) return;
    await roomRef.child('tasks/' + idx + '/status').set('done');
    toast('Görev tamamlandı olarak işaretlendi!');
  }

  function checkIncomingPenaltyPopup() {
    if (!roomData?.tasks || !uid || isSpectator()) return;
    const tasks = Array.isArray(roomData.tasks) ? roomData.tasks : Object.values(roomData.tasks || {});
    const incomingForMe = tasks.filter((t) => t && t.target === uid);
    if (!incomingForMe.length) return;

    const unseen = incomingForMe.filter((t) => !shownPenaltyIds.has(t.id));
    if (unseen.length > 0) {
      const nextTask = unseen[0];
      shownPenaltyIds.add(nextTask.id);
      playPenaltySound();
      openPenaltyPopup(nextTask);
    }
  }

  function renderLoserPenaltyBanner() {
    const resultEl = $('result');
    if (!resultEl || !roomData?.tasks || !uid) return;
    const tasks = Array.isArray(roomData.tasks) ? roomData.tasks : Object.values(roomData.tasks || {});
    const myPenalties = tasks.filter((t) => t && t.target === uid);

    let box = $('loserPenaltyBox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'loserPenaltyBox';
      box.style.cssText = 'margin:14px 0;text-align:left;';
      const backBtn = $('backToStart');
      if (backBtn && backBtn.parentNode) {
        backBtn.parentNode.insertBefore(box, backBtn);
      } else {
        resultEl.appendChild(box);
      }
    }

    if (!myPenalties.length) {
      box.innerHTML =
        '<div style="padding:12px 14px;border-radius:14px;background:#fef3c7;border:1px solid #fcd34d;color:#92400e;font-weight:600;text-align:center;">⏳ Kazanan rakibin sana ceza seçiyor, ceza geldiğinde ekranında görünecek.</div>';
      return;
    }

    box.innerHTML = myPenalties
      .map((t) => {
        const senderName = roomData.players?.[t.sender]?.name || 'Rakibin';
        const statusLabel =
          t.status === 'vetoed' ? '🚫 Veto Edildi' : t.status === 'done' ? 'Tamamlandı ✓' : 'Bekliyor';
        return `
        <div style="border-radius:16px;padding:14px;margin-bottom:10px;border:2px solid #ef4444;background:linear-gradient(135deg,#fef2f2,#fee2e2);">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="background:#dc2626;color:#fff;font-size:.75rem;font-weight:800;padding:3px 10px;border-radius:999px;">
              🎯 ${escapeHtml(senderName)} TARAFINDAN VERİLDİ
            </span>
            <b style="color:#b91c1c;">-${t.penalty || 0} Puan</b>
          </div>
          <h4 style="margin:8px 0 4px;color:#111827;">${t.emoji || '🎭'} ${escapeHtml(t.name)}</h4>
          <p style="margin:0 0 8px;color:#374151;font-size:.9rem;">${escapeHtml(t.desc)}</p>
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
            <small style="font-weight:600;color:#4b5563;">${statusLabel}</small>
            ${
              t.status !== 'done' && t.status !== 'vetoed'
                ? `<div style="display:flex;gap:6px;">
                    <button type="button" class="btn secondary small" data-loser-done="${escapeHtml(t.id)}">Görevi Tamamladım</button>
                    <button type="button" class="btn secondary small" data-loser-veto="${escapeHtml(t.id)}">🚫 40p Veto</button>
                   </div>`
                : ''
            }
          </div>
        </div>`;
      })
      .join('');

    box.querySelectorAll('[data-loser-done]').forEach((btn) => {
      btn.onclick = () => completeTask(btn.dataset.loserDone);
    });
    box.querySelectorAll('[data-loser-veto]').forEach((btn) => {
      btn.onclick = () => vetoTask(btn.dataset.loserVeto);
    });
  }

  function openPenaltyPopup(task) {
    closePenaltyPopup();
    const senderName = roomData?.players?.[task.sender]?.name || 'Rakibin';
    const secTotal = Number(task.durationSec || 20);

    const overlay = document.createElement('div');
    overlay.id = 'penaltyModalOverlay';
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,.72);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;padding:18px;';

    overlay.innerHTML = `
      <div class="bd-shake" style="width:100%;max-width:390px;background:linear-gradient(160deg,#ffffff 0%,#fff5f5 100%);border-radius:24px;padding:24px 20px;box-shadow:0 24px 60px rgba(0,0,0,.35);border:2px solid #fca5a5;text-align:center;">
        <div style="width:68px;height:68px;margin:0 auto 12px;border-radius:20px;background:linear-gradient(135deg,#ef4444,#f97316);color:#fff;font-size:2.1rem;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 24px rgba(239,68,68,.35);">
          ${task.emoji || '🎭'}
        </div>
        <span style="display:inline-block;background:#fee2e2;color:#b91c1c;font-weight:800;font-size:.75rem;letter-spacing:.04em;padding:4px 12px;border-radius:999px;margin-bottom:8px;">
          SANA CEZA GELDİ!
        </span>
        <h2 style="margin:4px 0 6px;font-size:1.35rem;color:#111827;">${escapeHtml(task.name)}</h2>
        <p style="margin:0 0 12px;color:#4b5563;font-size:.95rem;line-height:1.45;">${escapeHtml(task.desc)}</p>
        <div style="margin-bottom:12px;">
          <button type="button" id="penaltyStartTimerBtn" class="btn secondary small">⏱️ ${secTotal} sn Ceza Sayacı Başlat</button>
          <div id="penaltyCountdownDisplay" style="margin-top:6px;font-weight:800;color:#dc2626;font-size:1rem;"></div>
        </div>
        <div style="background:#fff;border:1px dashed #fca5a5;border-radius:14px;padding:10px 12px;margin-bottom:16px;display:flex;justify-content:space-around;align-items:center;">
          <div>
            <small style="display:block;color:#6b7280;font-size:.75rem;">Gönderen</small>
            <b style="color:#111827;font-size:.92rem;">${escapeHtml(senderName)}</b>
          </div>
          <div style="width:1px;height:28px;background:#e5e7eb;"></div>
          <div>
            <small style="display:block;color:#6b7280;font-size:.75rem;">Puan Cezası</small>
            <b style="color:#dc2626;font-size:.98rem;">-${task.penalty || 0} Puan</b>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" id="penaltyDoneModalBtn" class="btn primary full" style="flex:1;">✓ Yaptım, Tamamla</button>
          <button type="button" id="penaltyVetoModalBtn" class="btn secondary small" style="padding:0 12px;">🚫 40p Veto</button>
          <button type="button" id="penaltyCloseModalBtn" class="btn secondary small" style="padding:0 12px;">Kapat</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    $('penaltyStartTimerBtn').onclick = () => {
      clearInterval(penaltyCountdownInterval);
      let rem = secTotal;
      const disp = $('penaltyCountdownDisplay');
      if (disp) disp.textContent = `Kalan Süre: ${rem} sn`;
      penaltyCountdownInterval = setInterval(() => {
        rem--;
        if (disp) disp.textContent = rem > 0 ? `Kalan Süre: ${rem} sn` : '⏰ Süre Doldu!';
        if (rem <= 0) {
          clearInterval(penaltyCountdownInterval);
          playTone(740, 0.25, 'triangle', 0.24);
        }
      }, 1000);
    };

    $('penaltyDoneModalBtn').onclick = async () => {
      clearInterval(penaltyCountdownInterval);
      await completeTask(task.id);
      closePenaltyPopup();
      if (!isCurrentUserWinner()) renderLoserPenaltyBanner();
    };
    $('penaltyVetoModalBtn').onclick = async () => {
      await vetoTask(task.id);
      closePenaltyPopup();
      if (!isCurrentUserWinner()) renderLoserPenaltyBanner();
    };
    $('penaltyCloseModalBtn').onclick = () => closePenaltyPopup();
  }

  function closePenaltyPopup() {
    clearInterval(penaltyCountdownInterval);
    const existing = $('penaltyModalOverlay');
    if (existing) existing.remove();
  }

  async function finalizeGameWithPenalties() {
    if (!roomRef || finishingGame) return;
    finishingGame = true;
    clearInterval(timerInterval);
    clearTimeout(turnAdvanceTimer);

    try {
      await roomRef.transaction((data) => {
        if (!data) return data;
        const players = data.players || {};

        Object.keys(players).forEach((pid) => {
          if (players[pid] && players[pid].prePenaltyScore === undefined) {
            players[pid].prePenaltyScore = Number(players[pid].score || 0);
          }
        });

        const tasks = Array.isArray(data.tasks) ? data.tasks : Object.values(data.tasks || {});
        tasks.forEach((t) => {
          if (t && !t.applied && t.status !== 'vetoed' && t.target && players[t.target]) {
            const pen = Number(t.penalty || 0);
            players[t.target].score = Math.max(0, Number(players[t.target].score || 0) - pen);
            t.applied = true;
          }
        });

        data.players = players;
        data.tasks = tasks;
        data.status = 'finished';
        return data;
      });
    } catch (e) {
      console.error(e);
      await roomRef.update({ status: 'finished' });
    } finally {
      finishingGame = false;
    }
  }

  $('openMarket').onclick = () => {
    renderMarket();
    show('market');
  };

  $('closeMarket').onclick = () => {
    if (roomData?.status === 'finished') renderResult();
    else if (roomData?.status === 'playing') {
      if (isNumberPuzzleMode()) renderNumberPuzzleGame();
      else renderGame();
    } else show('game');
  };

  function ensureResultPenaltyAndRematchButtons() {
    const resultEl = $('result');
    const backBtn = $('backToStart');
    if (!resultEl || !backBtn) return;

    let btn = $('endPenaltyBtn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'endPenaltyBtn';
      btn.type = 'button';
      btn.className = 'btn secondary full';
      backBtn.parentNode.insertBefore(btn, backBtn);
    }

    const iAmWinner = isCurrentUserWinner();
    btn.textContent = iAmWinner ? '🎭 Ceza Verme Alanını Aç' : '📋 Gelen Cezaları Gör';
    btn.onclick = () => {
      renderMarket();
      show('market');
    };

    let shareCardBtn = $('bdShareMatchCardBtn');
    if (!shareCardBtn) {
      shareCardBtn = document.createElement('button');
      shareCardBtn.id = 'bdShareMatchCardBtn';
      shareCardBtn.type = 'button';
      shareCardBtn.className = 'btn secondary full';
      shareCardBtn.textContent = '📤 Maç Kartını Kopyala / Paylaş';
      backBtn.parentNode.insertBefore(shareCardBtn, backBtn);
    }
    shareCardBtn.onclick = async () => {
      const p = Object.values(roomData?.players || {})
        .filter((x) => !x.spectator)
        .sort((a, b) => (b.score || 0) - (a.score || 0));
      const lines = [
        `🏆 Bilgi Düellosu Maç Kartı (Oda #${roomId})`,
        ...p.map((x, idx) => `${idx === 0 ? '🥇' : '🥈'} ${x.name}: ${x.score || 0} puan (${x.correct || 0}D / ${x.wrong || 0}Y)`)
      ].join('\n');
      try {
        await navigator.clipboard.writeText(lines);
        toast('📋 Maç kartı panoya kopyalandı!');
      } catch {
        toast(lines);
      }
    };

    let rematchBtn = $('rematchBtn');
    if (!rematchBtn) {
      rematchBtn = document.createElement('button');
      rematchBtn.id = 'rematchBtn';
      rematchBtn.type = 'button';
      rematchBtn.className = 'btn secondary full';
      rematchBtn.textContent = '🔄 Rövanş Başlat (Canlı Rastgele Sorular)';
      backBtn.parentNode.insertBefore(rematchBtn, backBtn);
    }

    rematchBtn.onclick = async () => {
      if (!roomRef || !roomData) return;
      const count = Number(roomData.settings?.count || 10);
      const freshDeck = isNumberPuzzleMode()
        ? []
        : await fetchRandomQuestionsFromWeb(
            count,
            roomData?.settings?.category || 'Karışık',
            roomData?.settings?.difficulty || 'Karışık'
          );

      const resetPlayers = {};
      Object.entries(roomData.players || {}).forEach(([pid, pObj]) => {
        resetPlayers[pid] = {
          ...pObj,
          ready: pObj.spectator ? true : false,
          score: 0,
          correct: 0,
          wrong: 0,
          streak: 0,
          jokers: pObj.spectator ? { fifty: 0, plusTime: 0, doublePts: 0 } : { fifty: 1, plusTime: 1, doublePts: 1 },
          prePenaltyScore: null
        };
      });

      handledFinishView = false;
      recordedMatchId = null;
      localStreak = 0;
      doublePointsArmed = false;
      activeBetAmount = 0;
      used5050OnTurn = -1;
      hiddenOptionIndices.clear();
      shownPenaltyIds.clear();
      closePenaltyPopup();

      const payload = {
        status: 'lobby',
        turn: 0,
        answers: {},
        tasks: [],
        sabotage: null,
        questions: freshDeck.map((q) => ({ ...q })),
        players: resetPlayers
      };

      if (isNumberPuzzleMode()) {
        payload.numberPuzzle = {
          setterSlot: 1,
          guesserSlot: 2,
          secretNumber: null,
          questionsLeft: 10,
          pendingQuestion: null,
          history: [],
          completedTurns: 0
        };
      }

      await roomRef.update(payload);
      toast('🔄 Rövanş lobisi canlı rastgele sorularla hazır!');
    };
  }

  function renderBadgesBanner(players) {
    const resultEl = $('result');
    const scoresEl = $('resultScores');
    if (!resultEl || !scoresEl) return;

    let bBox = $('bdMvpBadgesBox');
    if (!bBox) {
      bBox = document.createElement('div');
      bBox.id = 'bdMvpBadgesBox';
      bBox.style.cssText = 'margin:10px 0;display:flex;gap:8px;flex-wrap:wrap;justify-content:center;';
      scoresEl.parentNode.insertBefore(bBox, scoresEl.nextSibling);
    }

    if (!players.length) {
      bBox.innerHTML = '';
      return;
    }

    const topScorer = [...players].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
    const topStreak = [...players].sort((a, b) => (b.streak || 0) - (a.streak || 0))[0];

    const badges = [];
    if (topScorer) badges.push(`🏅 Skor Lideri: ${topScorer.name}`);
    if (topStreak && (topStreak.streak || 0) >= 2) badges.push(`🔥 Seri Makinesi: ${topStreak.name} (${topStreak.streak}x)`);

    bBox.innerHTML = badges
      .map(
        (txt) =>
          `<span style="background:#fef3c7;color:#92400e;border:1px solid #fcd34d;padding:4px 10px;border-radius:999px;font-size:.78rem;font-weight:800;">${escapeHtml(
            txt
          )}</span>`
      )
      .join('');
  }

  function renderMatchSummaryReview() {
    const resultEl = $('result');
    const backBtn = $('backToStart');
    if (!resultEl || !backBtn) return;

    let sumBox = $('bdMatchSummaryReview');
    if (!sumBox) {
      sumBox = document.createElement('div');
      sumBox.id = 'bdMatchSummaryReview';
      sumBox.style.cssText =
        'margin:12px 0;padding:12px;border-radius:14px;border:1px solid #e5e7eb;text-align:left;max-height:220px;overflow-y:auto;font-size:.84rem;';
      backBtn.parentNode.insertBefore(sumBox, backBtn);
    }

    if (isNumberPuzzleMode()) {
      sumBox.innerHTML = '<b>🔢 Sayı Bulmaca Tamamlandı</b>';
      return;
    }

    const qs = Array.isArray(roomData?.questions) ? roomData.questions : [];
    const ansMap = roomData?.answers || {};

    if (!qs.length) {
      sumBox.innerHTML = '';
      return;
    }

    sumBox.innerHTML =
      '<b style="display:block;margin-bottom:8px;">📝 Maç Özeti & Soru İnceleme</b>' +
      qs
        .map((q, idx) => {
          const a = ansMap[idx];
          const rightOpt = Array.isArray(q.a) ? q.a[q.k] || '' : '';
          return `
          <div style="padding:8px 10px;margin-bottom:6px;border-radius:10px;background:rgba(148,163,184,.12);">
            <div><b>S${idx + 1}:</b> ${escapeHtml(q.q || '')}</div>
            <div style="color:#16a34a;font-weight:600;">✓ Cevap: ${escapeHtml(rightOpt)}</div>
            <small>${
              a
                ? `${escapeHtml(a.byName || 'Oyuncu')} · ${
                    a.correct ? `Doğru (${a.earned >= 0 ? '+' : ''}${a.earned || 0}p)` : `Yanlış (${a.earned || 0}p)`
                  }`
                : 'Cevaplanmadı'
            }</small>
          </div>`;
        })
        .join('');
  }

  function renderResult() {
    clearInterval(timerInterval);
    clearTimeout(turnAdvanceTimer);
    show('result');
    ensureResultPenaltyAndRematchButtons();
    if (!roomData?.players) return;

    const p = Object.values(roomData.players)
      .filter((x) => !x.spectator)
      .sort((a, b) => (b.score || 0) - (a.score || 0));
    const winner = p[0];
    const tie = p.length > 1 && (p[0].score || 0) === (p[1].score || 0);

    $('resultTitle').textContent = tie ? 'Berabere!' : (winner?.name || 'Kazanan') + ' kazandı!';
    $('resultScores').innerHTML = p
      .map(
        (x) => `
        <div>
          <b>${escapeHtml(x.name)}</b>
          <h2>${x.score || 0} puan</h2>
          <small>${x.correct || 0} doğru · ${x.wrong || 0} yanlış</small>
        </div>`
      )
      .join('');

    renderBadgesBanner(p);
    renderMatchSummaryReview();

    const tasks = Array.isArray(roomData.tasks) ? roomData.tasks : Object.values(roomData.tasks || {});
    const appliedList = tasks.filter((t) => t && Number(t.penalty || 0) > 0 && t.status !== 'vetoed');
    const penaltyNote = appliedList.length
      ? ' Uygulanan oyun sonu cezaları: ' +
        appliedList
          .map((t) => {
            const targetName = roomData.players[t.target]?.name || 'Rakip';
            return `${targetName} (-${t.penalty} puan: ${t.name})`;
          })
          .join(', ') +
        '.'
      : '';

    $('resultText').textContent =
      (tie ? 'Bu düelloda kazanan yok!' : (winner?.name || 'Kazanan') + ' bilgi gücünü gösterdi!') + penaltyNote;

    if (!isSpectator() && !isCurrentUserWinner()) {
      renderLoserPenaltyBanner();
    }
  }

  // --- ANLIK UÇUŞAN TEPKİ EMOJİLERİ ---
  const FLOAT_EMOJIS = ['🔥', '😂', '👏', '⚡', '😱', '😎'];

  function ensureReactionBar() {
    if ($('bdReactionBar')) return;
    const bar = document.createElement('div');
    bar.id = 'bdReactionBar';
    bar.style.cssText =
      'position:fixed;left:16px;bottom:16px;z-index:9000;display:flex;gap:6px;background:rgba(255,255,255,.92);backdrop-filter:blur(6px);padding:6px 10px;border-radius:999px;box-shadow:0 8px 24px rgba(0,0,0,.15);border:1px solid #e5e7eb;';
    bar.innerHTML = FLOAT_EMOJIS.map(
      (em) =>
        `<button type="button" data-float-emoji="${em}" style="background:none;border:none;font-size:1.2rem;cursor:pointer;padding:2px 5px;transition:transform .15s;">${em}</button>`
    ).join('');
    document.body.appendChild(bar);

    bar.querySelectorAll('[data-float-emoji]').forEach((btn) => {
      btn.onclick = async () => {
        if (!roomRef || !uid) return;
        playTone(720, 0.07, 'sine', 0.14);
        await roomRef.child('reactions').push({
          id: Date.now() + '_' + uid.slice(0, 4) + '_' + Math.random().toString(36).slice(2, 5),
          emoji: btn.dataset.floatEmoji,
          by: uid,
          at: Date.now()
        });
      };
    });
  }

  function removeReactionBar() {
    const b = $('bdReactionBar');
    if (b) b.remove();
  }

  function checkNewFloatingReactions() {
    if (!roomData?.reactions) return;
    const arr = Array.isArray(roomData.reactions) ? roomData.reactions : Object.values(roomData.reactions);
    arr.slice(-10).forEach((r) => {
      if (!r || !r.id || seenReactionIds.has(r.id)) return;
      seenReactionIds.add(r.id);
      if (Date.now() - Number(r.at || 0) < 12000) {
        spawnFloatingEmoji(r.emoji || '🔥');
      }
    });
  }

  function spawnFloatingEmoji(emoji) {
    const el = document.createElement('div');
    el.textContent = emoji;
    const leftPx = 40 + Math.random() * Math.max(120, window.innerWidth - 120);
    el.style.cssText = `position:fixed;left:${leftPx}px;bottom:70px;z-index:9500;font-size:2.1rem;pointer-events:none;transition:transform 1.4s ease-out,opacity 1.4s ease-out;opacity:1;`;
    document.body.appendChild(el);
    requestAnimationFrame(() => {
      el.style.transform = 'translateY(-170px) scale(1.25)';
      el.style.opacity = '0';
    });
    setTimeout(() => el.remove(), 1450);
  }

  // --- ONLİNE SOHBET, HAZIR REPLİKLER, YAZIYOR GÖSTERGESİ & EMOJİ ---
  const QUICK_EMOJIS = ['😂', '🔥', '👏', '😱', '🤔', '😎', '🎉', '💀'];
  const QUICK_PHRASES = ['İyi şanslar!', 'Kolaydı 😎', 'Şansın yaver gitti!', 'Rövanş?'];

  function ensureChatWidget() {
    if ($('bdChatWrap')) return;

    const wrap = document.createElement('div');
    wrap.id = 'bdChatWrap';
    wrap.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9000;font-family:inherit;';

    wrap.innerHTML = `
      <div id="bdChatBox" class="hidden" style="width:310px;max-width:calc(100vw - 32px);background:#fff;border-radius:18px;box-shadow:0 16px 40px rgba(0,0,0,.22);border:1px solid #e5e7eb;overflow:hidden;margin-bottom:10px;">
        <div style="background:linear-gradient(135deg,#ff7a24,#f97316);color:#fff;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;">
          <b style="font-size:.9rem;">💬 Düello Sohbeti</b>
          <button type="button" id="bdChatClose" style="background:none;border:none;color:#fff;font-size:1.1rem;cursor:pointer;">✕</button>
        </div>
        <div id="bdChatList" style="height:165px;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:6px;background:#f8fafc;font-size:.86rem;"></div>
        <div id="bdTypingStatus" style="padding:2px 10px;font-size:.74rem;color:#64748b;background:#f8fafc;min-height:18px;"></div>
        <div id="bdPhraseBar" style="display:flex;gap:4px;flex-wrap:wrap;padding:6px 8px;background:#fff;border-top:1px solid #f1f5f9;">
          ${QUICK_PHRASES.map(
            (ph) =>
              `<button type="button" data-chat-phrase="${escapeHtml(
                ph
              )}" style="background:#f1f5f9;color:#334155;border:1px solid #e2e8f0;border-radius:999px;font-size:.72rem;padding:2px 8px;cursor:pointer;font-weight:600;">${escapeHtml(
                ph
              )}</button>`
          ).join('')}
        </div>
        <div id="bdEmojiBar" style="display:flex;justify-content:space-between;padding:6px 8px;background:#fff7ed;border-top:1px solid #fed7aa;">
          ${QUICK_EMOJIS.map(
            (em) =>
              `<button type="button" data-chat-emoji="${em}" style="background:none;border:none;font-size:1.15rem;cursor:pointer;padding:2px 4px;">${em}</button>`
          ).join('')}
        </div>
        <form id="bdChatForm" style="display:flex;border-top:1px solid #e5e7eb;background:#fff;">
          <input id="bdChatInput" maxlength="120" placeholder="Mesaj yaz..." style="flex:1;border:none;padding:9px 10px;outline:none;font-size:.88rem;">
          <button type="submit" style="background:#ff7a24;color:#fff;border:none;padding:0 14px;font-weight:700;cursor:pointer;">Gönder</button>
        </form>
      </div>
      <button type="button" id="bdChatToggle" style="margin-left:auto;display:flex;align-items:center;gap:6px;background:linear-gradient(135deg,#ff7a24,#ea580c);color:#fff;border:none;border-radius:999px;padding:10px 16px;font-weight:700;box-shadow:0 10px 24px rgba(234,88,12,.38);cursor:pointer;">
        💬 Sohbet <span id="bdChatBadge" class="hidden" style="background:#ef4444;color:#fff;border:none;border-radius:999px;padding:1px 7px;font-size:.75rem;">0</span>
      </button>
    `;

    document.body.appendChild(wrap);

    $('bdChatToggle').onclick = () => {
      chatOpen = !chatOpen;
      $('bdChatBox').classList.toggle('hidden', !chatOpen);
      if (chatOpen) {
        const list = getChatArray();
        lastSeenChatCount = list.length;
        $('bdChatBadge').classList.add('hidden');
        const listEl = $('bdChatList');
        if (listEl) listEl.scrollTop = listEl.scrollHeight;
      }
    };

    $('bdChatClose').onclick = () => {
      chatOpen = false;
      $('bdChatBox').classList.add('hidden');
    };

    $('bdChatInput').oninput = async () => {
      if (!roomRef || !uid) return;
      await roomRef.child('typing/' + uid).set(Date.now());
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        roomRef?.child('typing/' + uid).remove().catch(() => {});
      }, 2000);
    };

    $('bdPhraseBar').querySelectorAll('[data-chat-phrase]').forEach((btn) => {
      btn.onclick = () => sendChatMessage(btn.dataset.chatPhrase, false);
    });

    $('bdEmojiBar').querySelectorAll('[data-chat-emoji]').forEach((btn) => {
      btn.onclick = () => sendChatMessage(btn.dataset.chatEmoji, true);
    });

    $('bdChatForm').onsubmit = (e) => {
      e.preventDefault();
      const inp = $('bdChatInput');
      const val = inp.value.trim();
      if (!val) return;
      inp.value = '';
      roomRef?.child('typing/' + uid).remove().catch(() => {});
      sendChatMessage(val, false);
    };
  }

  function updateTypingIndicator() {
    const el = $('bdTypingStatus');
    if (!el || !roomData?.typing) return;
    const now = Date.now();
    const activeTypers = Object.entries(roomData.typing)
      .filter(([pid, ts]) => pid !== uid && now - Number(ts || 0) < 2500)
      .map(([pid]) => roomData?.players?.[pid]?.name || 'Rakip');
    el.textContent = activeTypers.length ? `✍️ ${activeTypers.join(', ')} yazıyor...` : '';
  }

  function removeChatWidget() {
    const w = $('bdChatWrap');
    if (w) w.remove();
    chatOpen = false;
  }

  function getChatArray() {
    if (!roomData?.chat) return [];
    return Array.isArray(roomData.chat) ? roomData.chat : Object.values(roomData.chat);
  }

  async function sendChatMessage(text, isEmoji = false) {
    if (!roomRef || !uid || !roomData?.players?.[uid]) return;
    const me = roomData.players[uid];
    const msgObj = {
      id: Date.now() + '_' + uid.slice(0, 4),
      by: uid,
      name: me.name || 'Oyuncu',
      avatar: me.avatar || '🧠',
      text,
      isEmoji,
      at: Date.now()
    };

    try {
      playTone(640, 0.06, 'sine', 0.12);
      await roomRef.child('chat').push(msgObj);
    } catch (e) {
      console.error(e);
    }
  }

  function renderChatMessages() {
    const listEl = $('bdChatList');
    if (!listEl) return;
    const msgs = getChatArray();

    if (!msgs.length) {
      listEl.innerHTML = '<div style="color:#9ca3af;text-align:center;margin-top:55px;">Henüz mesaj yok. Emoji gönder!</div>';
    } else {
      listEl.innerHTML = msgs
        .slice(-40)
        .map((m) => {
          const isMe = m.by === uid;
          return `
          <div style="align-self:${isMe ? 'flex-end' : 'flex-start'};max-width:82%;background:${
            isMe ? '#ffedd5' : '#ffffff'
          };border:1px solid ${isMe ? '#fed7aa' : '#e5e7eb'};border-radius:12px;padding:6px 10px;">
            <div style="font-size:.7rem;color:#6b7280;margin-bottom:2px;">${escapeHtml(m.avatar || '')} ${escapeHtml(
            isMe ? 'Sen' : m.name || 'Rakip'
          )}</div>
            <div style="font-size:${m.isEmoji ? '1.45rem' : '.86rem'};color:#111827;word-break:break-word;">${escapeHtml(
            m.text || ''
          )}</div>
          </div>`;
        })
        .join('');
      listEl.scrollTop = listEl.scrollHeight;
    }

    const badge = $('bdChatBadge');
    if (!badge) return;
    if (chatOpen) {
      lastSeenChatCount = msgs.length;
      badge.classList.add('hidden');
    } else if (msgs.length > lastSeenChatCount) {
      const diff = msgs.length - lastSeenChatCount;
      badge.textContent = diff;
      badge.classList.remove('hidden');
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  }

  $('backToStart').onclick = () => {
    clearInterval(timerInterval);
    clearTimeout(turnAdvanceTimer);
    removeChatWidget();
    removeReactionBar();
    closePenaltyPopup();
    if (roomRef) roomRef.off();
    roomRef = null;
    roomData = null;
    finishingGame = false;
    handledFinishView = false;
    ensureProfileBadge();
    show('home');
  };

  window.addEventListener('beforeunload', () => {
    clearInterval(timerInterval);
    clearTimeout(turnAdvanceTimer);
    if (roomRef && uid) {
      roomRef.child('players/' + uid + '/connected').set(false);
    }
  });

  ensureProfileBadge();
  show('home');
})();
