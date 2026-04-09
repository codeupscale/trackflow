/* ============================================
   TrackFlow Product Demo — Script
   Auto-playing presentation with manual controls
   ============================================ */

(function () {
  'use strict';

  // ── Slide Configuration ──
  const SLIDES = [
    { id: 'intro',       duration: 4000 },
    { id: 'problem',     duration: 5000 },
    { id: 'solution',    duration: 5000 },
    { id: 'time',        duration: 8000 },
    { id: 'activity',    duration: 8000 },
    { id: 'screenshots', duration: 6000 },
    { id: 'dashboard',   duration: 8000 },
    { id: 'hr',          duration: 10000 },
    { id: 'security',    duration: 5000 },
    { id: 'comparison',  duration: 6000 },
    { id: 'pricing',     duration: 4000 },
    { id: 'cta',         duration: 4000 },
  ];

  let currentSlide = 0;
  let isPlaying = true;
  let slideTimer = null;
  let progressTimer = null;
  let progressStartTime = 0;
  let progressDuration = 0;

  // ── DOM References ──
  const slides = document.querySelectorAll('.slide');
  const progressBar = document.querySelector('.progress-bar');
  const slideCounter = document.querySelector('.slide-counter');
  const pauseIndicator = document.querySelector('.pause-indicator');

  // ── Initialize ──
  function init() {
    updateCounter();
    showSlide(0);
    startAutoPlay();
    bindKeys();
  }

  // ── Slide Transitions ──
  function showSlide(index) {
    if (index < 0 || index >= SLIDES.length) return;

    const prevSlide = slides[currentSlide];
    const nextSlide = slides[index];

    if (prevSlide && prevSlide !== nextSlide) {
      prevSlide.classList.add('exiting');
      prevSlide.classList.remove('active');
      setTimeout(() => prevSlide.classList.remove('exiting'), 600);
    }

    currentSlide = index;
    nextSlide.classList.add('active');
    updateCounter();
    triggerSlideAnimations(SLIDES[index].id);

    if (isPlaying) {
      startSlideTimer();
    }
  }

  function nextSlide() {
    if (currentSlide < SLIDES.length - 1) {
      showSlide(currentSlide + 1);
    } else {
      // Loop back to start
      showSlide(0);
    }
  }

  function prevSlide() {
    if (currentSlide > 0) {
      showSlide(currentSlide - 1);
    }
  }

  // ── Auto-Play ──
  function startAutoPlay() {
    isPlaying = true;
    pauseIndicator.classList.remove('visible');
    startSlideTimer();
  }

  function stopAutoPlay() {
    isPlaying = false;
    pauseIndicator.classList.add('visible');
    clearTimeout(slideTimer);
    cancelAnimationFrame(progressTimer);
  }

  function togglePlay() {
    if (isPlaying) {
      stopAutoPlay();
    } else {
      startAutoPlay();
    }
  }

  function startSlideTimer() {
    clearTimeout(slideTimer);
    cancelAnimationFrame(progressTimer);

    const duration = SLIDES[currentSlide].duration;
    progressStartTime = performance.now();
    progressDuration = duration;

    slideTimer = setTimeout(() => {
      nextSlide();
    }, duration);

    animateProgress();
  }

  function animateProgress() {
    const elapsed = performance.now() - progressStartTime;
    const totalElapsed = currentSlide * (1 / SLIDES.length) * 100;
    const slideProgress = Math.min(elapsed / progressDuration, 1) * (1 / SLIDES.length) * 100;
    const totalProgress = totalElapsed + slideProgress;

    progressBar.style.width = totalProgress + '%';

    if (elapsed < progressDuration && isPlaying) {
      progressTimer = requestAnimationFrame(animateProgress);
    }
  }

  // ── Counter ──
  function updateCounter() {
    slideCounter.textContent = (currentSlide + 1) + ' / ' + SLIDES.length;
  }

  // ── Keyboard Controls ──
  function bindKeys() {
    document.addEventListener('keydown', function (e) {
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          e.preventDefault();
          nextSlide();
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          prevSlide();
          break;
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
      }
    });

    // Click to advance
    document.querySelector('.presentation').addEventListener('click', function (e) {
      if (e.target.closest('.controls-hint') || e.target.closest('.slide-counter') || e.target.closest('.pause-indicator')) return;
      nextSlide();
    });
  }

  // ── Slide-Specific Animations ──
  function triggerSlideAnimations(slideId) {
    switch (slideId) {
      case 'intro':
        animateIntro();
        break;
      case 'problem':
        animateProblem();
        break;
      case 'solution':
        animateSolution();
        break;
      case 'time':
        animateTime();
        break;
      case 'activity':
        animateActivity();
        break;
      case 'screenshots':
        animateScreenshots();
        break;
      case 'dashboard':
        animateDashboard();
        break;
      case 'hr':
        animateHR();
        break;
      case 'security':
        animateSecurity();
        break;
      case 'comparison':
        animateComparison();
        break;
      case 'pricing':
        animatePricing();
        break;
      case 'cta':
        animateCTA();
        break;
    }
  }

  // ── Intro Slide ──
  function animateIntro() {
    // Logo + text animations are CSS-driven via keyframes on .active
    // Reset animations by removing and re-adding active state handled via CSS
  }

  // ── Problem Slide ──
  function animateProblem() {
    const points = document.querySelectorAll('#slide-problem .pain-point');
    points.forEach(function (point, i) {
      point.classList.remove('animate-in');
      setTimeout(function () {
        point.classList.add('animate-in');
      }, 400 + i * 600);
    });
  }

  // ── Solution Slide ──
  function animateSolution() {
    const counterEl = document.querySelector('.feature-counter');
    const badges = document.querySelector('.platform-badges');

    // Reset
    counterEl.textContent = '0';
    badges.classList.remove('animate-in');

    // Count up to 70
    animateCounter(counterEl, 0, 70, 1500, function (val) {
      return val + '+';
    });

    setTimeout(function () {
      badges.classList.add('animate-in');
    }, 2000);
  }

  // ── Time Tracking Slide ──
  let timerInterval = null;
  function animateTime() {
    const timerDisplay = document.querySelector('.timer-value');
    const bullets = document.querySelectorAll('#slide-time .bullet-item');
    const syncAnim = document.querySelector('.sync-animation');
    const wifiIcon = document.querySelector('.wifi-icon');
    const syncStatus = document.querySelector('.sync-status');

    // Reset
    bullets.forEach(function (b) { b.classList.remove('animate-in'); });
    if (syncAnim) syncAnim.classList.remove('animate-in');
    if (syncStatus) syncStatus.classList.remove('visible');
    if (wifiIcon) {
      wifiIcon.classList.remove('offline');
      wifiIcon.classList.add('online');
    }

    // Ticking timer
    let seconds = 9257; // 02:34:17
    clearInterval(timerInterval);
    timerInterval = setInterval(function () {
      seconds++;
      var h = Math.floor(seconds / 3600);
      var m = Math.floor((seconds % 3600) / 60);
      var s = seconds % 60;
      timerDisplay.textContent =
        String(h).padStart(2, '0') + ':' +
        String(m).padStart(2, '0') + ':' +
        String(s).padStart(2, '0');
    }, 1000);

    // Bullet animation
    bullets.forEach(function (b, i) {
      setTimeout(function () {
        b.classList.add('animate-in');
      }, 300 + i * 400);
    });

    // Sync animation sequence
    if (syncAnim) {
      setTimeout(function () {
        syncAnim.classList.add('animate-in');
      }, 2200);

      // Go offline
      setTimeout(function () {
        if (wifiIcon) {
          wifiIcon.classList.remove('online');
          wifiIcon.classList.add('offline');
        }
      }, 3500);

      // Go online + sync
      setTimeout(function () {
        if (wifiIcon) {
          wifiIcon.classList.remove('offline');
          wifiIcon.classList.add('online');
        }
        if (syncStatus) syncStatus.classList.add('visible');
      }, 5500);
    }
  }

  // ── Activity Monitoring Slide ──
  function animateActivity() {
    const ring = document.querySelector('.ring-fill');
    const percentEl = document.querySelector('.activity-percent-value');
    const bars = document.querySelectorAll('.app-bar-item');
    const barFills = document.querySelectorAll('.app-bar-fill');

    // Reset
    if (ring) ring.classList.remove('animate');
    bars.forEach(function (b) { b.classList.remove('animate-in'); });
    barFills.forEach(function (b) { b.style.width = '0'; });

    // Animate ring
    setTimeout(function () {
      if (ring) ring.classList.add('animate');
      if (percentEl) animateCounter(percentEl, 0, 78, 1500, function (v) { return v + '%'; });
    }, 300);

    // Animate bars
    var barWidths = ['60%', '33%', '10%'];
    bars.forEach(function (b, i) {
      setTimeout(function () {
        b.classList.add('animate-in');
        setTimeout(function () {
          barFills[i].style.width = barWidths[i];
        }, 200);
      }, 800 + i * 400);
    });
  }

  // ── Screenshots Slide ──
  function animateScreenshots() {
    var frames = document.querySelectorAll('.screenshot-frame');
    var features = document.querySelectorAll('.ss-feature');

    frames.forEach(function (f) { f.classList.remove('animate-in'); });
    features.forEach(function (f) { f.classList.remove('animate-in'); });

    frames.forEach(function (f, i) {
      setTimeout(function () {
        f.classList.add('animate-in');
      }, 200 + i * 300);
    });

    features.forEach(function (f, i) {
      setTimeout(function () {
        f.classList.add('animate-in');
      }, 1200 + i * 200);
    });
  }

  // ── Dashboard Slide ──
  function animateDashboard() {
    var mockup = document.querySelector('.dashboard-mockup');
    var bars = document.querySelectorAll('.dash-bar');
    var dots = document.querySelectorAll('.team-dot .dot');
    var statValues = document.querySelectorAll('.dash-stat-value');

    mockup.classList.remove('animate-in');
    bars.forEach(function (b) { b.style.height = '4px'; });
    dots.forEach(function (d) { d.classList.remove('online'); });

    setTimeout(function () {
      mockup.classList.add('animate-in');
    }, 200);

    // Animate bars
    var heights = ['140px', '90px', '170px', '120px', '80px', '150px', '60px'];
    setTimeout(function () {
      bars.forEach(function (b, i) {
        setTimeout(function () {
          b.style.height = heights[i] || '100px';
        }, i * 100);
      });
    }, 800);

    // Team dots come online
    setTimeout(function () {
      dots.forEach(function (d, i) {
        setTimeout(function () {
          d.classList.add('online');
        }, i * 400);
      });
    }, 1500);

    // Animate stat counters
    var statTargets = [
      { el: statValues[0], target: 847, suffix: 'h', duration: 1200 },
      { el: statValues[1], target: 78, suffix: '%', duration: 1000 },
      { el: statValues[2], target: 24, suffix: '', duration: 800 },
      { el: statValues[3], target: 12, suffix: '', duration: 600 },
    ];
    setTimeout(function () {
      statTargets.forEach(function (s) {
        if (s.el) animateCounter(s.el, 0, s.target, s.duration, function (v) { return v + s.suffix; });
      });
    }, 1000);
  }

  // ── HR Suite Slide ──
  function animateHR() {
    var cards = document.querySelectorAll('.hr-card');
    var bottomText = document.querySelector('.hr-bottom-text');

    cards.forEach(function (c) { c.classList.remove('animate-in'); });
    if (bottomText) bottomText.classList.remove('animate-in');

    cards.forEach(function (c, i) {
      setTimeout(function () {
        c.classList.add('animate-in');
      }, 300 + i * 500);
    });

    if (bottomText) {
      setTimeout(function () {
        bottomText.classList.add('animate-in');
      }, 2800);
    }
  }

  // ── Security Slide ──
  function animateSecurity() {
    var shield = document.querySelector('.shield-icon');
    var orbits = document.querySelectorAll('.orbit-item');

    if (shield) shield.classList.remove('animate-in');
    orbits.forEach(function (o) { o.classList.remove('animate-in'); });

    setTimeout(function () {
      if (shield) shield.classList.add('animate-in');
    }, 200);

    orbits.forEach(function (o, i) {
      setTimeout(function () {
        o.classList.add('animate-in');
      }, 600 + i * 250);
    });
  }

  // ── Comparison Slide ──
  function animateComparison() {
    var rows = document.querySelectorAll('.comparison-table tbody tr');
    rows.forEach(function (r) { r.classList.remove('animate-in'); });

    rows.forEach(function (r, i) {
      setTimeout(function () {
        r.classList.add('animate-in');
      }, 400 + i * 400);
    });
  }

  // ── Pricing Slide ──
  function animatePricing() {
    var cards = document.querySelectorAll('.pricing-card');
    var badge = document.querySelector('.trial-badge');

    cards.forEach(function (c) { c.classList.remove('animate-in'); });
    if (badge) badge.classList.remove('animate-in');

    cards.forEach(function (c, i) {
      setTimeout(function () {
        c.classList.add('animate-in');
      }, 200 + i * 300);
    });

    if (badge) {
      setTimeout(function () {
        badge.classList.add('animate-in');
      }, 1400);
    }
  }

  // ── CTA Slide ──
  function animateCTA() {
    var logo = document.querySelector('.cta-logo');
    var text = document.querySelector('.cta-text');
    var url = document.querySelector('.cta-url');
    var particles = document.querySelectorAll('.particle');

    if (logo) logo.classList.remove('animate-in');
    if (text) text.classList.remove('animate-in');
    if (url) url.classList.remove('animate-in');
    particles.forEach(function (p) { p.classList.remove('animate'); });

    setTimeout(function () {
      if (logo) logo.classList.add('animate-in');
    }, 200);

    setTimeout(function () {
      particles.forEach(function (p, i) {
        setTimeout(function () {
          p.classList.add('animate');
        }, i * 100);
      });
    }, 600);

    setTimeout(function () {
      if (text) text.classList.add('animate-in');
    }, 1000);

    setTimeout(function () {
      if (url) url.classList.add('animate-in');
    }, 1500);
  }

  // ── Utility: Counter Animation ──
  function animateCounter(element, from, to, duration, formatter) {
    var startTime = performance.now();
    formatter = formatter || function (v) { return v.toString(); };

    function update(now) {
      var elapsed = now - startTime;
      var progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      var eased = 1 - Math.pow(1 - progress, 3);
      var current = Math.round(from + (to - from) * eased);
      element.textContent = formatter(current);

      if (progress < 1) {
        requestAnimationFrame(update);
      }
    }

    requestAnimationFrame(update);
  }

  // ── Cleanup on slide change ──
  var originalShowSlide = showSlide;
  showSlide = function (index) {
    // Clear any running timers from previous slide
    if (SLIDES[currentSlide] && SLIDES[currentSlide].id === 'time') {
      clearInterval(timerInterval);
    }
    originalShowSlide(index);
  };

  // ── Start ──
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
