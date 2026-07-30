/*
  QuestLog AI — 퀘스트 생성 폼 (Phase 2)

  현재는 응답 JSON을 그대로 출력한다.
  Phase 3에서 renderResult() 안쪽만 퀘스트 카드 UI로 교체하면 된다.
*/

(function () {
  'use strict';

  var GOAL_MAX = 500;
  var PROGRESS_MAX = 300;
  var DEADLINE_MAX_DAYS = 30;
  var TIMEOUT_MS = 30000;

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
  var resultRawEl = document.getElementById('result-raw');

  // ── 날짜 유틸 ──────────────────────────────────────────
  // 사용자 PC 시계가 기준이므로 여기서 계산한 날짜는 입력 편의용일 뿐이다.
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

  // ── 화면 상태 ──────────────────────────────────────────

  function clearMessages() {
    statusEl.hidden = true;
    errorEl.hidden = true;
    Array.prototype.forEach.call(
      form.querySelectorAll('.field.has-error'),
      function (el) { el.classList.remove('has-error'); }
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

  // ── 클라이언트 검증 ────────────────────────────────────
  // 서버도 같은 검증을 한다. 여기서 막는 건 불필요한 호출을 줄이기 위한 것일 뿐,
  // 이 검증이 보안 장치는 아니다.

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

  // ── 결과 표시 ──────────────────────────────────────────
  // Phase 3에서 이 함수만 퀘스트 카드 렌더링으로 교체한다.

  function renderResult(data) {
    resultRawEl.textContent = JSON.stringify(data, null, 2);
    resultEl.hidden = false;
  }

  // ── 제출 ───────────────────────────────────────────────

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    clearMessages();
    resultEl.hidden = true;

    var invalid = validate();
    if (invalid) {
      showError(invalid.message, invalid.field);
      return;
    }

    var payload = {
      goal: goalEl.value.trim(),
      deadline: deadlineEl.value,
      dailyMinutes: parseInt(dailyHoursEl.value, 10),
      progress: progressEl.value.trim(),
      intensity: intensityEl.value
    };

    sendRequest(payload);
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
        // 서버는 성공/실패 모두 JSON으로 응답한다.
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
        renderResult(data);
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
})();
