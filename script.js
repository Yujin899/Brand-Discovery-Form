/* ================================================================
   BRAND DISCOVERY — One field per slide, fetched from questions.json
================================================================ */
const EASE_EXPO = "expo.inOut";
const EASE_POWER3 = "power3.out";
const EASE_BACK = "back.out(1.6)";

/* ----------------------------------------------------------------
   EMAIL JS CONFIGURATION
   1. Go to https://www.emailjs.com and create a free account
   2. Add an Email Service (Gmail, Outlook, etc.) — copy the Service ID
   3. Create an Email Template — copy the Template ID
      In the template body use the variable: {{answers}}
      Add "to_email" field pointing to your email address
   4. Go to Account > API Keys — copy your Public Key
   Then paste all three values below:
---------------------------------------------------------------- */
const EMAILJS_CONFIG = {
    publicKey: '3BnSZaIOqZcjWyX6a',   // e.g. 'abc123XYZ'
    serviceId: 'service_3izk1e9',   // e.g. 'service_xxxxxxx'
    templateId: 'template_saqjwei',  // e.g. 'template_xxxxxxx'
    toEmail: 'emad76065@gmail.com', // where submissions land
};

let FLAT_SLIDES = []; // flattened individual field slides

const LS_DATA_KEY = 'brand_discovery_data';
const LS_TIME_KEY = 'brand_discovery_timestamp';
const LS_INDEX_KEY = 'brand_discovery_index';
const LS_EXPIRY_DAYS = 7;

// ── FETCH ────────────────────────────────────────────────────────
async function fetchQuestions() {
    try {
        const r = await fetch('./questions.json');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        return Array.isArray(d.questions) ? d.questions : [];
    } catch (e) {
        console.error('[Discovery] Failed to load questions.json:', e);
        return [];
    }
}

// ── FLATTEN groups → one slide per field ─────────────────────────
function flattenToSlides(questions) {
    const slides = [];
    questions.forEach(q => {
        const fields = q.type === 'group' ? q.fields : [{ ...q.field, type: q.type, required: q.required }];
        fields.forEach((f, fi) => {
            slides.push({
                id: `${q.id}-${f.id}`,
                parentId: q.id,
                section: q.section,
                sectionNum: q.number,
                fieldIndex: fi,
                totalFields: fields.length,
                globalIndex: slides.length,
                field: f
            });
        });
    });
    return slides;
}

// ── BUILD SLIDES ─────────────────────────────────────────────────
function buildSlides(slides) {
    const wrap = document.querySelector('#form-wrapper');
    const dots = document.querySelector('#step-indicators');
    wrap.innerHTML = dots.innerHTML = '';

    slides.forEach((s, i) => {
        const f = s.field;
        const isLast = i === slides.length - 1;
        const context = `${s.sectionNum} — ${s.section}`;

        const slide = document.createElement('div');
        slide.className = 'q-slide';
        slide.id = `slide-${i}`;
        slide.dataset.index = i;

        slide.innerHTML = `
            <div class="q-number">${context}</div>
            <h2 class="q-question">${f.placeholder}</h2>
            <div class="field-group${f.type === 'chips' ? ' wide' : ''}">
                ${renderSingleField(f, i)}
            </div>
            <div class="q-actions">
                ${i > 0 ? `<button class="btn-back" data-back="${i}" type="button">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <line x1="19" y1="12" x2="5" y2="12"/>
                        <polyline points="12 19 5 12 12 5"/>
                    </svg>
                    <span>Back</span>
                </button>` : ''}
                ${f.type === 'boolean' ? '' : `
                <button class="btn-continue" data-slide="${i}" type="button">
                    <span>${isLast ? 'Submit' : 'Continue'}</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <line x1="5" y1="12" x2="19" y2="12"/>
                        <polyline points="12 5 19 12 12 19"/>
                    </svg>
                </button>
                <span class="key-hint">Press <kbd>Enter</kbd> ↵</span>
                `}
            </div>
        `;

        wrap.appendChild(slide);

        // One dot per section (grouped), not per field
        if (s.fieldIndex === 0) {
            const dot = document.createElement('div');
            dot.className = 'step-dot';
            dot.dataset.index = i;
            dots.appendChild(dot);
        }
    });
}

function renderSingleField(f, slideIndex) {
    if (f.type === 'textarea') {
        return `<div class="field-row" data-field-id="${f.id}">
                    <textarea id="${f.id}-${slideIndex}" class="pf-input pf-area"
                              placeholder="Type your answer…" rows="${f.rows || 3}"
                              spellcheck="false" ${f.required ? 'data-required' : ''}></textarea>
                </div>`;
    }

    if (f.type === 'chips') {
        const opts = f.options.map(o =>
            `<div class="chip" data-value="${o}" tabindex="0">${o}</div>`).join('');
        return `<div class="field-row chips-row" data-field-id="chips-${f.id}-${slideIndex}"
                     ${f.required ? 'data-required' : ''}>
                    <div class="option-chips" id="chips-${f.id}-${slideIndex}"
                         data-single="${!f.multiSelect}">${opts}</div>
                </div>`;
    }

    if (f.type === 'boolean') {
        return `<div class="field-row boolean-row" data-field-id="bool-${f.id}-${slideIndex}">
                    <div class="boolean-toggle" id="bool-${f.id}-${slideIndex}" data-value="">
                        <button class="bool-opt" data-val="yes" type="button">Yes</button>
                        <button class="bool-opt" data-val="no"  type="button">No</button>
                    </div>
                </div>`;
    }

    // text, url, email
    return `<div class="field-row" data-field-id="${f.id}-${slideIndex}">
                <input type="${f.type || 'text'}" id="${f.id}-${slideIndex}" class="pf-input"
                       placeholder="Type your answer…" autocomplete="off" spellcheck="false"
                       ${f.required ? 'data-required' : ''}>
            </div>`;
}

// ── FORM ENGINE ───────────────────────────────────────────────────
class FormEngine {
    constructor(slides) {
        this.slides = slides;
        this.idx = -1;
        this.total = slides.length;
        this.isAnimating = false;
        this.data = {};
        this._loadSavedData();
    }

    _loadSavedData() {
        try {
            const raw = localStorage.getItem(LS_DATA_KEY);
            const ts = localStorage.getItem(LS_TIME_KEY);
            if (!raw || !ts) return;
            const age = (Date.now() - parseInt(ts)) / (1000 * 60 * 60 * 24);
            if (age > LS_EXPIRY_DAYS) { this._clearStorage(); return; }
            this.data = JSON.parse(raw);
            this.savedIndex = parseInt(localStorage.getItem(LS_INDEX_KEY) || '0');
        } catch (e) { console.warn('Failed to load saved data:', e); }
    }

    _saveToStorage() {
        try {
            localStorage.setItem(LS_DATA_KEY, JSON.stringify(this.data));
            localStorage.setItem(LS_TIME_KEY, Date.now().toString());
            localStorage.setItem(LS_INDEX_KEY, this.idx.toString());
        } catch (e) { console.warn('Failed to save data:', e); }
    }

    _clearStorage() {
        localStorage.removeItem(LS_DATA_KEY);
        localStorage.removeItem(LS_TIME_KEY);
        localStorage.removeItem(LS_INDEX_KEY);
    }

    hasSavedData() {
        return Object.keys(this.data).length > 0 && this.savedIndex > 0;
    }

    startForm() {
        if (this.isAnimating) return;
        this.isAnimating = true;
        const intro = document.querySelector('#intro-slide');
        gsap.timeline({
            defaults: { ease: EASE_EXPO }, onComplete: () => {
                intro.style.pointerEvents = 'none';
                this.isAnimating = false;
            }
        })
            .to(intro, { yPercent: -100, duration: 1.2 })
            .to('#scroll-hint', { opacity: 1, duration: 0.6 }, '-=0.3')
            .to('#step-indicators', { opacity: 1, duration: 0.4 }, '-=0.4')
            .to('#progress-counter', { opacity: 1, duration: 0.4 }, '-=0.4');
        this.go(0);
    }

    go(target) {
        if (this.isAnimating && this.idx !== -1) return;
        const prev = this.idx;
        this.idx = target;
        const dir = target > prev ? 1 : -1;
        this.updateUI();
        if (prev >= 0) this.exitSlide(prev, dir);
        this.enterSlide(target, dir);
    }

    enterSlide(i, dir) {
        this.isAnimating = true;
        const s = document.querySelector(`#slide-${i}`);
        s.classList.add('is-active');
        s.classList.remove('is-exited');

        const parts = ['.q-number', '.q-question', '.field-group', '.q-actions']
            .map(c => s.querySelector(c)).filter(Boolean);
        gsap.set(parts, { opacity: 0, y: 0, x: 0 });

        gsap.timeline({
            defaults: { ease: EASE_EXPO }, onComplete: () => {
                this.isAnimating = false;
                const inp = s.querySelector('input, textarea');
                if (inp) setTimeout(() => inp.focus(), 80);
            }
        })
            .fromTo(s, { y: dir > 0 ? '100vh' : '-100vh', opacity: 0 }, { y: '0%', opacity: 1, duration: 0.9 }, 0)
            .fromTo(s.querySelector('.q-number'),
                { opacity: 0, x: -16 }, { opacity: 1, x: 0, duration: 0.5, ease: EASE_POWER3 }, 0.35)
            .fromTo(s.querySelector('.q-question'),
                { opacity: 0, y: 36, clipPath: 'inset(0 0 100% 0)' },
                { opacity: 1, y: 0, clipPath: 'inset(0 0 0% 0)', duration: 0.85, ease: EASE_POWER3 }, 0.46)
            .fromTo(s.querySelector('.field-group'),
                { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.65, ease: EASE_POWER3 }, 0.66)
            .fromTo(s.querySelector('.q-actions'),
                { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.5, ease: EASE_POWER3 }, 0.82);
    }

    exitSlide(i, dir) {
        const s = document.querySelector(`#slide-${i}`);
        const parts = ['.q-number', '.q-question', '.field-group', '.q-actions']
            .map(c => s.querySelector(c)).filter(Boolean);
        gsap.timeline({
            defaults: { ease: EASE_EXPO }, onComplete: () => {
                s.classList.remove('is-active');
                s.classList.add('is-exited');
                gsap.set(s, { y: dir > 0 ? '100vh' : '-100vh', opacity: 0 });
            }
        })
            .to(parts, { opacity: 0, y: dir > 0 ? -24 : 24, duration: 0.35, stagger: 0.04, ease: 'power2.in' }, 0)
            .to(s, { y: dir > 0 ? '-100vh' : '100vh', duration: 0.7 }, 0.1);
    }

    validate() {
        const s = document.querySelector(`#slide-${this.idx}`);
        const slide = this.slides[this.idx];
        if (!s || !slide) return true;

        const f = slide.field;
        if (!f.required) return true;

        const uid = `${this.idx}`;

        if (f.type === 'chips') {
            const row = s.querySelector(`[data-field-id="chips-${f.id}-${uid}"]`);
            const sel = s.querySelectorAll(`#chips-${f.id}-${uid} .chip.is-selected`).length;
            if (sel === 0) { if (row) this.shakeRow(row); return false; }
        } else if (f.type === 'boolean') {
            // boolean is never blocking
            return true;
        } else {
            const row = s.querySelector(`[data-field-id="${f.id}-${uid}"]`);
            const el = s.querySelector(`#${f.id}-${uid}`);
            if (!el?.value.trim()) { if (row) this.shakeRow(row); return false; }
        }
        return true;
    }

    shakeRow(row) {
        row.classList.add('has-error');
        gsap.timeline()
            .to(row, { x: -8, duration: 0.07 }).to(row, { x: 7, duration: 0.07 })
            .to(row, { x: -5, duration: 0.07 }).to(row, { x: 4, duration: 0.07 })
            .to(row, { x: 0, duration: 0.07 });
    }

    shakeBtn() {
        const b = document.querySelector(`[data-slide="${this.idx}"]`);
        if (!b) return;
        gsap.timeline()
            .to(b, { x: -10, duration: 0.07 }).to(b, { x: 10, duration: 0.07 })
            .to(b, { x: -8, duration: 0.07 }).to(b, { x: 8, duration: 0.07 })
            .to(b, { x: 0, duration: 0.10, ease: EASE_BACK });
    }

    goNext() {
        if (this.isAnimating) return;
        if (!this.validate()) { this.shakeBtn(); return; }
        this.collect();
        const next = this.idx + 1;
        if (next >= this.total) { this.finish(); return; }
        this.go(next);
    }

    goPrev() {
        if (this.isAnimating || this.idx <= 0) return;
        this.go(this.idx - 1);
    }

    collect() {
        const s = document.querySelector(`#slide-${this.idx}`);
        const slide = this.slides[this.idx];
        if (!s || !slide) return;
        const f = slide.field;
        const uid = `${this.idx}`;
        const pid = slide.parentId;

        if (!this.data[pid]) this.data[pid] = {};

        if (f.type === 'chips') {
            this.data[pid][f.id] = [...s.querySelectorAll(`#chips-${f.id}-${uid} .chip.is-selected`)].map(c => c.dataset.value);
        } else if (f.type === 'boolean') {
            this.data[pid][f.id] = s.querySelector(`#bool-${f.id}-${uid}`)?.dataset.value || '';
        } else {
            this.data[pid][f.id] = s.querySelector(`#${f.id}-${uid}`)?.value.trim() || '';
        }
        this._saveToStorage();
    }

    updateUI() {
        const slide = this.slides[this.idx];
        const pct = ((this.idx + 1) / this.total) * 100;
        gsap.to('#progress-fill', { width: `${pct}%`, duration: 0.5, ease: EASE_EXPO });

        // Progress counter
        const counter = document.querySelector('#progress-counter');
        if (counter) counter.textContent = `${this.idx + 1} / ${this.total}`;

        // Highlight dot for section
        document.querySelectorAll('.step-dot').forEach(d => {
            const di = parseInt(d.dataset.index);
            d.classList.toggle('is-active', di <= this.idx);
        });
    }

    finish() {
        this.isAnimating = true;

        // Show loading state on the submit button
        const submitBtn = document.querySelector(`[data-slide="${this.idx}"]`);
        if (submitBtn) {
            submitBtn.classList.add('is-loading');
            submitBtn.disabled = true;
            submitBtn.querySelector('span').textContent = 'Sending\u2026';
        }

        // Send email first, then animate thank-you screen
        sendEmail(this.data).finally(() => {
            this._clearStorage();
            this.exitSlide(this.idx, 1);
            const ty = document.querySelector('#thankyou-slide');
            gsap.timeline({ defaults: { ease: EASE_EXPO }, onComplete: () => { this.isAnimating = false; } })
                .to(ty, { y: '0%', duration: 1.1 }, 0.2)
                .fromTo('.ty-tag', { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.6 }, 0.8)
                .fromTo('.ty-h2', { y: 50, opacity: 0 }, { y: 0, opacity: 1, duration: 1.0, ease: EASE_POWER3 }, 0.95)
                .fromTo('.ty-p', { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7 }, 1.2)
                .to('#btn-restart-ty', { opacity: 1, duration: 0.5, ease: EASE_BACK }, 1.5);
        });

        gsap.to(['#progress-track', '#progress-counter', '#step-indicators', '#scroll-hint', '#topnav'],
            { opacity: 0, duration: 0.4, delay: 0.2 });
    }

    restart() { this._clearStorage(); location.reload(); }
}

// ── INTRO ─────────────────────────────────────────────────────────
function initIntroAnimation() {
    gsap.timeline({ defaults: { ease: EASE_POWER3 } })
        .fromTo('.intro-grid-line',
            { scaleY: 0, transformOrigin: 'top center' },
            { scaleY: 1, duration: 1.4, stagger: 0.07, ease: 'power2.inOut' }, 0)
        .fromTo('.intro-eyebrow',
            { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.7 }, 0.4)
        .fromTo('.intro-h1 .word',
            { yPercent: 110 }, { yPercent: 0, duration: 1.0, stagger: 0.11, ease: 'expo.out' }, 0.6)
        .fromTo('.intro-desc',
            { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.8 }, 1.1)
        .fromTo('.btn-start',
            { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.7, ease: EASE_BACK }, 1.4)
        .fromTo('.nav-logo, .nav-step, .nav-close-btn',
            { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.07 }, 1.1);
}

// ── CURSOR ────────────────────────────────────────────────────────
function initCursor() {
    const dot = document.querySelector('#cursor-dot');
    const ring = document.querySelector('#cursor-ring');
    if (!dot || !ring) return;
    let mx = 0, my = 0, rx = 0, ry = 0;
    document.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; gsap.set(dot, { x: mx, y: my }); });
    gsap.ticker.add(() => { rx += (mx - rx) * 0.12; ry += (my - ry) * 0.12; gsap.set(ring, { x: rx, y: ry }); });
    const sel = 'button,.chip,input,textarea,a,[tabindex]';
    document.addEventListener('mouseover', e => { if (e.target.matches(sel)) document.body.classList.add('cursor-hover'); });
    document.addEventListener('mouseout', e => { if (e.target.matches(sel)) document.body.classList.remove('cursor-hover'); });
}

// ── CHIPS ─────────────────────────────────────────────────────────
function initChips() {
    document.addEventListener('click', e => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        const cont = chip.closest('.option-chips');
        const single = cont?.dataset.single === 'true';
        if (single) cont.querySelectorAll('.chip.is-selected').forEach(c => { if (c !== chip) c.classList.remove('is-selected'); });
        if (chip.classList.contains('is-selected') && !single) chip.classList.remove('is-selected');
        else { chip.classList.add('is-selected'); gsap.fromTo(chip, { scale: 0.9 }, { scale: 1, duration: 0.35, ease: EASE_BACK }); }
        chip.closest('[data-field-id]')?.classList.remove('has-error');
    });
    document.addEventListener('keydown', e => {
        if (e.key === ' ' && document.activeElement?.classList.contains('chip')) { e.preventDefault(); document.activeElement.click(); }
    });
}

// ── BOOLEANS (auto-advance on selection) ─────────────────────────
function initBooleans(engine) {
    document.addEventListener('click', e => {
        const btn = e.target.closest('.bool-opt');
        if (!btn) return;
        const toggle = btn.closest('.boolean-toggle');
        if (!toggle) return;
        toggle.querySelectorAll('.bool-opt').forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        toggle.dataset.value = btn.dataset.val;
        gsap.fromTo(btn, { scale: 0.94 }, { scale: 1, duration: 0.3, ease: EASE_BACK });
        // Auto-advance after short delay for great UX
        setTimeout(() => engine.goNext(), 420);
    });
}

// ── KEYBOARD / WHEEL / TOUCH ──────────────────────────────────────
function initKeyboard(engine) {
    document.addEventListener('keydown', e => {
        if (e.key === 'Enter' && engine.idx >= 0) {
            if (document.activeElement?.tagName === 'TEXTAREA') return;
            e.preventDefault(); engine.goNext();
        }
    });
    let locked = false;
    document.addEventListener('wheel', e => {
        if (engine.idx < 0 || locked) return;
        locked = true; setTimeout(() => { locked = false; }, 900);
        if (e.deltaY > 40) engine.goNext(); else if (e.deltaY < -40) engine.goPrev();
    }, { passive: true });
    let ty0 = 0;
    document.addEventListener('touchstart', e => { ty0 = e.touches[0].clientY; }, { passive: true });
    document.addEventListener('touchend', e => {
        if (engine.idx < 0) return;
        const dy = ty0 - e.changedTouches[0].clientY;
        if (Math.abs(dy) > 80) { dy > 0 ? engine.goNext() : engine.goPrev(); }
    }, { passive: true });
}

// ── CLEAR ERRORS ON INPUT ─────────────────────────────────────────
function initInputErrors() {
    document.addEventListener('input', e => {
        if (e.target.matches('input, textarea'))
            e.target.closest('[data-field-id]')?.classList.remove('has-error');
    });
}

// ── BUTTONS ───────────────────────────────────────────────────────
function initButtons(engine) {
    document.querySelector('#btn-start')?.addEventListener('click', () => engine.startForm());
    document.querySelector('#btn-restart')?.addEventListener('click', () => engine.restart());
    document.querySelector('#btn-restart-ty')?.addEventListener('click', () => engine.restart());
    document.addEventListener('click', e => { if (e.target.closest('.btn-continue')) engine.goNext(); });
    document.addEventListener('click', e => { if (e.target.closest('.btn-back')) engine.goPrev(); });
}

// ── LOADING ───────────────────────────────────────────────────────
function hideLoader() {
    const el = document.querySelector('#loading-overlay');
    if (el) gsap.to(el, { opacity: 0, duration: 0.5, onComplete: () => el.remove() });
}
function showLoadError() {
    const el = document.querySelector('#loading-overlay');
    if (el) el.innerHTML = `<div style="text-align:center;padding:24px;max-width:300px">
        <p style="color:#B23A3A;font-family:sans-serif;font-size:0.9rem;line-height:1.7">
            Could not load <strong>questions.json</strong>.<br><br>
            Please open via a local server (e.g. VS Code <strong>Live Server</strong>).
        </p></div>`;
}

// ── EMAIL JS — FORMAT & SEND ──────────────────────────────────────
function sendEmail(data) {
    // Check credentials have been filled in
    if (EMAILJS_CONFIG.publicKey === 'YOUR_PUBLIC_KEY') {
        console.warn('⚠️ EmailJS not configured. Fill in EMAILJS_CONFIG in script.js.');
        return Promise.resolve(); // Silently continue so thank-you screen still shows
    }

    // Build a clean, readable email body from all answers
    const lines = [];
    for (const [sectionId, answers] of Object.entries(data)) {
        // Section header
        lines.push(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        lines.push(sectionId.toUpperCase().replace(/_/g, ' '));
        lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

        for (const [fieldId, value] of Object.entries(answers)) {
            // Convert field id to a readable label
            const label = fieldId
                .replace(/^f-/, '')
                .replace(/-/g, ' ')
                .replace(/\b\w/g, c => c.toUpperCase());

            const answer = Array.isArray(value)
                ? value.join(', ') || '(not answered)'
                : value || '(not answered)';

            lines.push(`\n${label}:\n${answer}`);
        }
    }

    const formattedAnswers = lines.join('\n');
    console.log('📋 Formatted Email Body:', formattedAnswers);
    
    const submittedAt = new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' });

    const templateParams = {
        to_email: EMAILJS_CONFIG.toEmail,
        subject: `Brand Discovery Submission — ${submittedAt}`,
        answers: formattedAnswers,
        message: formattedAnswers, // Added 'message' as fallback for default EmailJS templates
        submitted_at: submittedAt,
    };

    return emailjs
        .send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId, templateParams)
        .then(() => console.log('✅ Brand Discovery email sent successfully.'))
        .catch(err => console.error('❌ EmailJS send failed:', err));
}

// ── RESTORE SAVED VALUES INTO DOM ─────────────────────────────────
function restoreSlideValues(slides, data) {
    slides.forEach((s, i) => {
        const f = s.field;
        const uid = `${i}`;
        const pid = s.parentId;
        const saved = data[pid]?.[f.id];
        if (saved === undefined || saved === '') return;

        const el = document.querySelector(`#slide-${i}`);
        if (!el) return;

        if (f.type === 'chips' && Array.isArray(saved)) {
            saved.forEach(val => {
                const chip = el.querySelector(`.chip[data-value="${val}"]`);
                if (chip) chip.classList.add('is-selected');
            });
        } else if (f.type === 'boolean' && saved) {
            const toggle = el.querySelector(`#bool-${f.id}-${uid}`);
            if (toggle) {
                toggle.dataset.value = saved;
                const btn = toggle.querySelector(`[data-val="${saved}"]`);
                if (btn) btn.classList.add('is-active');
            }
        } else {
            const inp = el.querySelector(`#${f.id}-${uid}`);
            if (inp) inp.value = saved;
        }
    });
}

// ── TEXTAREA AUTO-RESIZE ──────────────────────────────────────────
function initTextareaResize() {
    document.addEventListener('input', e => {
        if (e.target.tagName === 'TEXTAREA') {
            e.target.style.height = 'auto';
            e.target.style.height = e.target.scrollHeight + 'px';
        }
    });
}

// ── AUTO-SAVE ON INPUT (debounced) ────────────────────────────────
function initAutoSave(engine) {
    let timer;
    document.addEventListener('input', e => {
        if (!e.target.matches('input, textarea') || engine.idx < 0) return;
        clearTimeout(timer);
        timer = setTimeout(() => engine.collect(), 500);
    });
}

// ── RESUME OVERLAY ────────────────────────────────────────────────
function initResume(engine) {
    const overlay = document.querySelector('#resume-overlay');
    if (!overlay) return;

    if (!engine.hasSavedData()) {
        overlay.style.display = 'none';
        return;
    }

    // Show the resume overlay on top of the intro
    overlay.classList.add('is-visible');

    document.querySelector('#btn-resume')?.addEventListener('click', () => {
        gsap.to(overlay, {
            opacity: 0, duration: 0.5, ease: EASE_EXPO,
            onComplete: () => {
                overlay.style.display = 'none';
                restoreSlideValues(engine.slides, engine.data);
                engine.startForm();
                // Jump to last saved slide after a brief delay for the start animation
                const target = Math.min(engine.savedIndex || 0, engine.total - 1);
                if (target > 0) {
                    setTimeout(() => engine.go(target), 1000);
                }
            }
        });
    });

    document.querySelector('#btn-fresh')?.addEventListener('click', () => {
        engine._clearStorage();
        engine.data = {};
        gsap.to(overlay, {
            opacity: 0, duration: 0.5, ease: EASE_EXPO,
            onComplete: () => { overlay.style.display = 'none'; }
        });
    });
}

// ── INIT ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    // Initialise EmailJS with your public key
    if (typeof emailjs !== 'undefined' && EMAILJS_CONFIG.publicKey !== 'YOUR_PUBLIC_KEY') {
        emailjs.init({ publicKey: EMAILJS_CONFIG.publicKey });
    }

    const questions = await fetchQuestions();
    if (!questions.length) { showLoadError(); return; }

    // Flatten groups → individual field slides
    FLAT_SLIDES = flattenToSlides(questions);
    buildSlides(FLAT_SLIDES);

    const engine = new FormEngine(FLAT_SLIDES);
    initCursor();
    initChips();
    initBooleans(engine);
    initInputErrors();
    initKeyboard(engine);
    initButtons(engine);
    initTextareaResize();
    initAutoSave(engine);
    initResume(engine);

    hideLoader();
    requestAnimationFrame(() => setTimeout(initIntroAnimation, 60));
});
