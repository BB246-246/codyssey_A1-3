/*
  QuestLog AI — 퀘스트 생성 폼과 결과 렌더링

  서버 응답 형식은 docs/api-contract.md 를 따른다.
  결과는 브라우저의 localStorage 에만 저장한다. 서버에는 아무것도 남기지 않는다.
*/

(function () {
  'use strict';

  var GOAL_MAX = 500;
  var PROGRESS_MAX = 300;
  var DEADLINE_MAX_DAYS = 30;
  var TIMEOUT_MS = 30000;
  var STORAGE_KEY = 'questlog:plan:v1';

  var TYPE_LABEL = { main: '필수 퀘스트', side: '사이드 퀘스트' };
  var PRIORITY_LABEL = { high: '높음', medium: '보통', low: '낮음' };
  var WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

  var form = document.getElementById('plan-form');
  var goalEl = document.getElementById('goal');
  var goalCountEl = document.getElementById('goal-count');
  var deadlineEl = document.getElementById('deadline');
  var dailyHoursEl = document.getElementById('dailyHours');
  var progressEl = document.getElementById('progress');
  var intensityEl = document.getElementById('intensity');
  var submitBtn = document.getElementById('submit-btn');

  var statusEl = document.getElementById('status');
  var errorEl = document.getElementById('error');
  var resultEl = document.getElementById('result');
  var restoredNoteEl = document.getElementById('restored-note');

  var planTitleEl = document.getElementById('plan-title');
  var planSummaryEl = document.getElementById('plan-summary');
  var metaDdayEl = document.getElementById('meta-dday');
  var metaBudgetEl = document.getElementById('meta-budget');
  var xpTextEl = document.getElementById('xp-text');
  var xpTrackEl = document.querySelector('.xp-track');
  var xpFillEl = document.getElementById('xp-fill');
  var budgetWarningEl = document.getElementById('budget-warning');
  var timelineEl = document.getElementById('timeline');
  var bossEl = document.getElementById('boss');
  var checklistEl = document.getElementById('checklist');
  var cautionsEl = document.getElementById('cautions');

  // 현재 화면에 그려진 계획과 완료 체크 상태
  var current = null;   // 서버 응답 전체
  var checked = {};     // { questId: true }

  // ── 표시 유틸 ──────────────────────────────────────────

  function formatMinutes(minutes) {
    var h = Math.floor(minutes / 60);
    var m = minutes % 60;
    if (h && m) { return h + '시간 ' + m + '분'; }
    if (h) { return h + '시간'; }
    return m + '분';
  }

  function parseDate(iso) {
    // new Date('2026-08-02') 는 UTC 로 해석되어 시간대에 따라 하루 밀린다.
    // 로컬 날짜로 직접 만든다.
    var parts = iso.split('-');
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  function formatDate(iso) {
    var d = parseDate(iso);
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + WEEKDAYS[d.getDay()] + ')';
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) { node.className = className; }
    // AI가 생성한 문자열이 그대로 들어오므로 textContent 로만 넣는다.
    // innerHTML 을 쓰면 응답에 섞인 태그가 실행될 수 있다.
    if (text !== undefined && text !== null) { node.textContent = text; }
    return node;
  }

  // ── 화면 상태 ──────────────────────────────────────────

  function clearMessages() {
    statusEl.hidden = true;
    errorEl.hidden = true;
    Array.prototype.forEach.call(
      form.querySelectorAll('.field.has-error'),
      function (node) { node.classList.remove('has-error'); }
    );
  }

  function showStatus(message) {
    statusEl.textContent = message;
    statusEl.hidden = false;
  }

  function showError(message, field) {
    statusEl.hidden = true;
    errorEl.textContent = message;
    errorEl.hidden = false;

    if (field) {
      var input = document.getElementById(field === 'dailyMinutes' ? 'dailyHours' : field);
      if (input) {
        var wrapper = input.closest('.field');
        if (wrapper) { wrapper.classList.add('has-error'); }
        input.focus();
      }
    }
  }

  function setLoading(isLoading) {
    submitBtn.disabled = isLoading;
    submitBtn.textContent = isLoading ? '생성 중...' : 'AI 계획 생성';
  }

  // ── 저장 (브라우저 전용) ───────────────────────────────

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        data: current,
        checked: checked
      }));
    } catch (e) {
      // 저장 실패(용량 초과, 사생활 보호 모드)해도 계획 자체는 계속 쓸 수 있다.
    }
  }

  function restore() {
    var raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return;
    }
    if (!raw) { return; }

    try {
      var saved = JSON.parse(raw);
      if (!saved || !saved.data || !saved.data.plan) { return; }
      current = saved.data;
      checked = saved.checked || {};
      render(current);
      restoredNoteEl.hidden = false;
    } catch (e) {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e2) { /* 무시 */ }
    }
  }

  // ── 진행도 ─────────────────────────────────────────────

  function totalQuestCount() {
    return current.plan.quests.length + 1; // 보스전 포함
  }

  function updateProgress() {
    var total = totalQuestCount();
    var done = 0;
    Object.keys(checked).forEach(function (key) {
      if (checked[key]) { done += 1; }
    });

    var percent = total ? Math.round((done / total) * 100) : 0;
    xpFillEl.style.width = percent + '%';
    xpTextEl.textContent = done + ' / ' + total + ' 완료 (' + percent + '%)';
    if (xpTrackEl) { xpTrackEl.setAttribute('aria-valuenow', String(percent)); }
  }

  function onToggle(questId, isChecked, card) {
    checked[questId] = isChecked;
    card.classList.toggle('is-done', isChecked);
    updateProgress();
    save();
  }

  // ── 퀘스트 카드 ────────────────────────────────────────

  function buildCard(quest, options) {
    var isBoss = !!(options && options.boss);
    var card = el('div', 'quest-card' + (isBoss ? ' quest-card-boss' : ' quest-card-' + quest.type));
    if (checked[quest.id]) { card.classList.add('is-done'); }

    var head = el('div', 'quest-card-head');
    var label = isBoss ? '보스전' : TYPE_LABEL[quest.type];
    head.appendChild(el('span', 'tag tag-' + (isBoss ? 'boss' : quest.type), label));
    if (!isBoss) {
      head.appendChild(el('span', 'tag tag-priority tag-' + quest.priority,
        '우선순위 ' + PRIORITY_LABEL[quest.priority]));
    }
    head.appendChild(el('span', 'quest-time', formatMinutes(quest.minutes)));
    card.appendChild(head);

    var checkboxId = 'check-' + quest.id;
    var titleRow = el('div', 'quest-title-row');

    var box = document.createElement('input');
    box.type = 'checkbox';
    box.id = checkboxId;
    box.className = 'quest-check';
    box.checked = !!checked[quest.id];
    box.addEventListener('change', function () {
      onToggle(quest.id, box.checked, card);
    });

    var title = el('label', 'quest-title', quest.title);
    title.setAttribute('for', checkboxId);

    titleRow.appendChild(box);
    titleRow.appendChild(title);
    card.appendChild(titleRow);

    card.appendChild(el('p', 'quest-detail', quest.detail));
    return card;
  }

  // ── 렌더링 ─────────────────────────────────────────────

  function render(data) {
    var meta = data.meta;
    var plan = data.plan;

    planTitleEl.textContent = plan.title;
    planSummaryEl.textContent = plan.summary;

    metaDdayEl.textContent = meta.remainingDays === 1
      ? '오늘이 마감입니다'
      : '마감까지 ' + meta.remainingDays + '일 (' + formatDate(meta.deadline) + ')';
    metaBudgetEl.textContent =
      '계획 ' + formatMinutes(meta.plannedMinutes) +
      ' / 가용 ' + formatMinutes(meta.totalBudgetMinutes);

    // 시간 초과는 오류가 아니라 경고다. 계획은 그대로 보여준다.
    if (meta.budgetStatus === 'over') {
      budgetWarningEl.textContent =
        '계획된 시간이 쓸 수 있는 시간을 넘습니다. 사이드 퀘스트부터 덜어내세요.';
      budgetWarningEl.hidden = false;
    } else if (meta.budgetStatus === 'full') {
      budgetWarningEl.textContent = '일정이 빠듯합니다. 여유 시간이 거의 없습니다.';
      budgetWarningEl.hidden = false;
    } else {
      budgetWarningEl.hidden = true;
    }

    renderTimeline(meta, plan);

    bossEl.textContent = '';
    var bossQuest = {
      id: 'boss',
      title: plan.bossFight.title,
      detail: plan.bossFight.detail,
      minutes: plan.bossFight.minutes
    };
    bossEl.appendChild(el('p', 'day-label', formatDate(plan.bossFight.date) + ' · 마감일'));
    bossEl.appendChild(buildCard(bossQuest, { boss: true }));

    fillList(checklistEl, plan.checklist);
    fillList(cautionsEl, plan.cautions);

    updateProgress();
    resultEl.hidden = false;
  }

  function renderTimeline(meta, plan) {
    timelineEl.textContent = '';

    // 날짜별 초과 여부를 빠르게 찾기 위한 표
    var loadByDay = {};
    meta.dayLoads.forEach(function (load) { loadByDay[load.day] = load; });

    // 같은 날짜의 퀘스트를 한 묶음으로 만든다.
    // 서버는 평평한 배열로 보내고, 묶는 것은 화면의 몫이다.
    var groups = [];
    plan.quests.forEach(function (quest) {
      var last = groups[groups.length - 1];
      if (last && last.day === quest.day) {
        last.quests.push(quest);
      } else {
        groups.push({ day: quest.day, date: quest.date, quests: [quest] });
      }
    });

    groups.forEach(function (group) {
      var item = el('li', 'timeline-item');

      var label = group.day === 1
        ? '오늘 · ' + formatDate(group.date)
        : 'D-' + (meta.remainingDays - group.day) + ' · ' + formatDate(group.date);

      var head = el('p', 'day-label', label);
      var load = loadByDay[group.day];
      if (load && load.status === 'over') {
        head.appendChild(el('span', 'day-badge',
          '하루 가능 시간 초과 (' + formatMinutes(load.minutes) + ')'));
      }
      item.appendChild(head);

      group.quests.forEach(function (quest) {
        item.appendChild(buildCard(quest));
      });

      timelineEl.appendChild(item);
    });
  }

  function fillList(container, items) {
    container.textContent = '';
    items.forEach(function (text) {
      container.appendChild(el('li', null, text));
    });
  }

  // ── 날짜 입력 초기화 ───────────────────────────────────
  // 여기서 계산한 날짜는 입력 편의용이다.
  // 실제 남은 일수는 서버가 서버 시각으로 다시 계산한다.

  function toISODate(date) {
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, '0');
    var d = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  function addDays(date, days) {
    var next = new Date(date.getTime());
    next.setDate(next.getDate() + days);
    return next;
  }

  function initDeadline() {
    var today = new Date();
    deadlineEl.min = toISODate(today);
    deadlineEl.max = toISODate(addDays(today, DEADLINE_MAX_DAYS - 1));
    deadlineEl.value = toISODate(addDays(today, 6));
  }

  // ── 검증 ───────────────────────────────────────────────
  // 서버도 같은 검증을 한다. 여기서 막는 것은 불필요한 호출을 줄이기 위한 것이며,
  // 이 검증 자체는 보안 장치가 아니다.

  function validate() {
    if (!goalEl.value.trim()) {
      return { message: '달성하고 싶은 목표를 입력해 주세요.', field: 'goal' };
    }
    if (goalEl.value.trim().length > GOAL_MAX) {
      return { message: '목표는 500자 이내로 입력해 주세요.', field: 'goal' };
    }
    if (progressEl.value.trim().length > PROGRESS_MAX) {
      return { message: '현재 진행 상황은 300자 이내로 입력해 주세요.', field: 'progress' };
    }
    if (!deadlineEl.value) {
      return { message: '마감일을 선택해 주세요.', field: 'deadline' };
    }
    return null;
  }

  // ── 제출 ───────────────────────────────────────────────

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    clearMessages();

    var invalid = validate();
    if (invalid) {
      showError(invalid.message, invalid.field);
      return;
    }

    sendRequest({
      goal: goalEl.value.trim(),
      deadline: deadlineEl.value,
      dailyMinutes: parseInt(dailyHoursEl.value, 10),
      progress: progressEl.value.trim(),
      intensity: intensityEl.value
    });
  });

  function sendRequest(payload) {
    setLoading(true);
    showStatus('계획을 생성하고 있습니다. 최대 30초 정도 걸릴 수 있습니다.');

    // 응답이 오지 않을 때 무한 대기를 막는다.
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

    fetch('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    })
      .then(function (response) {
        // 서버는 성공/실패 모두 JSON 으로 응답한다.
        return response.json().catch(function () {
          throw new Error('계획 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.');
        });
      })
      .then(function (data) {
        if (!data || data.ok !== true) {
          var err = (data && data.error) || {};
          showError(
            err.message || '계획 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.',
            err.field
          );
          return;
        }

        clearMessages();
        current = data;
        checked = {};           // 새 계획이므로 진행도를 초기화한다.
        restoredNoteEl.hidden = true;
        render(current);
        save();
        resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      })
      .catch(function (error) {
        if (error && error.name === 'AbortError') {
          showError('응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.');
        } else {
          showError(error.message || '계획 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.');
        }
      })
      .finally(function () {
        clearTimeout(timer);
        setLoading(false);
      });
  }

  // ── 초기화 ─────────────────────────────────────────────

  goalEl.addEventListener('input', function () {
    goalCountEl.textContent = goalEl.value.length;
  });

  initDeadline();
  restore();
})();
