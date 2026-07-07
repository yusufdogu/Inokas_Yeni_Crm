// ─── AI SIDE PANEL ───────────────────────────────────────────────────────────
// Single panel shared across genel / giden / gelen tabs.
// Each tab has its own chat session AND its own activity feed cards.

// ── STATE ────────────────────────────────────────────────────────────────────
let _aiActiveSession = 'giden';

let _aiChatSessions = {
    genel: [{ role: 'assistant', text: 'Merhaba! Genel bakış verilerin üzerinde yardımcı olabilirim. Bir şey sor.' }],
    giden: [{ role: 'assistant', text: 'Merhaba! Giden faturalar üzerinde yardımcı olabilirim.' }],
    gelen: [{ role: 'assistant', text: 'Merhaba! Gelen faturalar üzerinde yardımcı olabilirim.' }],
};

const _aiQuickPromptsByTab = {
    genel: ['Bu ayki rapor', 'En büyük 5 fatura'],
    giden: ['Bu ayki toplam', 'En çok firma', 'USD faturalar'],
    gelen: ['Bu ayki toplam', 'En çok firma', 'USD faturalar'],
};

let _aiFeedData = { genel: [], giden: [], gelen: [] };


// ── ACTIVATE A SESSION (called from switchMainTab) ───────────────────────────
function setAiActiveSession(tab) {
    if (!['genel', 'giden', 'gelen'].includes(tab)) return;
    _aiActiveSession = tab;
    renderAiChat();
    loadAiFeedData(tab);
}


function renderAiChat() {
    const messages  = document.getElementById('aiMessages');
    const quickWrap = document.getElementById('aiQuickPrompts');
    if (!messages || !quickWrap) return;

    const session = _aiChatSessions[_aiActiveSession] || [];
    messages.innerHTML = session.map(m => {
        const role = m.role === 'user' ? 'user' : 'assistant';
        const bubbleCls = 'ai-msg-bubble' + (m.streaming ? ' ai-msg-bubble--streaming' : '');
        // Render markdown for assistant, escape plain for user
        const content = role === 'assistant'
            ? _aiRenderMarkdown(m.text)
            : _aiEscape(m.text);
        return `
            <div class="ai-msg ${role}">
                <div class="${bubbleCls}">${content}</div>
                <div class="ai-msg-meta">${role === 'user' ? 'Sen' : 'Asistan'}</div>
            </div>
        `;
    }).join('');
    messages.scrollTop = messages.scrollHeight;

    /*const prompts = _aiQuickPromptsByTab[_aiActiveSession] || [];
    quickWrap.innerHTML = prompts.map(p =>
        `<button class="ai-quick-chip" onclick="aiQuickPrompt(this)">${_aiEscape(p)}</button>`
    ).join('');*/
}


// ── SEND MESSAGE ─────────────────────────────────────────────────────────────
async function aiSendMessage() {
    //renderChatSkeleton('aiThinkingBubble');
    const input = document.getElementById('aiInput');
    if (!input) return;

    const text = input.value.trim();
    if (!text) return;

    const session = _aiChatSessions[_aiActiveSession];

    // Push the user message
    session.push({ role: 'user', text });

    // Push an empty assistant placeholder that we'll fill via streaming
    const assistantMsg = { role: 'assistant', text: '', streaming: true };
    session.push(assistantMsg);

    input.value = '';
    renderAiChat();

    // Grab a reference to the just-rendered empty bubble so we can update it
    // directly without re-rendering the entire chat on every token
    const messagesEl = document.getElementById('aiMessages');
    const bubbles    = messagesEl.querySelectorAll('.ai-msg.assistant .ai-msg-bubble');
    const bubble     = bubbles[bubbles.length - 1];

    try {
        await _aiStreamReply(text, session, assistantMsg, bubble);
    } catch (err) {
        console.error('aiSendMessage error:', err);
        assistantMsg.text = 'Bir hata oluştu: ' + (err.message || 'bilinmeyen');
        assistantMsg.streaming = false;
        if (bubble) bubble.innerHTML = _aiRenderMarkdown(assistantMsg.text);

    }
}

// ── QUICK PROMPT CLICK ───────────────────────────────────────────────────────
function aiQuickPrompt(el) {
    const input = document.getElementById('aiInput');
    if (input) input.value = el.textContent.trim();
    aiSendMessage();
}


// ── CLEAR CURRENT SESSION ────────────────────────────────────────────────────
function aiClearChat() {
    _aiChatSessions[_aiActiveSession] = [{
        role: 'assistant',
        text: _aiInitialMessage(_aiActiveSession),
    }];
    renderAiChat();
}

function _aiInitialMessage(tab) {
    if (tab === 'genel') return 'Merhaba! Genel bakış verilerin üzerinde yardımcı olabilirim. Bir şey sor.';
    if (tab === 'giden') return 'Merhaba! Giden faturalar üzerinde yardımcı olabilirim.';
    if (tab === 'gelen') return 'Merhaba! Gelen faturalar üzerinde yardımcı olabilirim.';
    return 'Merhaba!';
}


// ── COLLAPSE / EXPAND ACTIVITY FEED ──────────────────────────────────────────
function toggleAiFeed() {
    document.getElementById('aiFeed')?.classList.toggle('collapsed');
}


// ── LOAD ACTIVITY FEED DATA FOR A TAB ────────────────────────────────────────
async function loadAiFeedData(tab) {
    try {
        const cards = [];

        if (tab === 'genel') {
            const [pending, lastGiden, lastGelen] = await Promise.all([
                _aiFetchLastPending(),
                _aiFetchLastApproved('OUTGOING'),
                _aiFetchLastApproved('INCOMING'),
            ]);
            if (pending)   cards.push(_aiBuildFeedCard(pending,   'pending', 'Son Bekleyen'));
            if (lastGiden) cards.push(_aiBuildFeedCard(lastGiden, 'giden',   'Son Onaylanan Giden'));
            if (lastGelen) cards.push(_aiBuildFeedCard(lastGelen, 'gelen',   'Son Onaylanan Gelen'));
        } else if (tab === 'giden') {
            const [pending, lastApproved] = await Promise.all([
                _aiFetchLastPending('OUTGOING'),
                _aiFetchLastApproved('OUTGOING'),
            ]);
            if (pending)      cards.push(_aiBuildFeedCard(pending,      'pending', 'Son Bekleyen Giden'));
            if (lastApproved) cards.push(_aiBuildFeedCard(lastApproved, 'giden',   'Son Onaylanan'));
        } else if (tab === 'gelen') {
            const [pending, lastApproved] = await Promise.all([
                _aiFetchLastPending('INCOMING'),
                _aiFetchLastApproved('INCOMING'),
            ]);
            if (pending)      cards.push(_aiBuildFeedCard(pending,      'pending', 'Son Bekleyen Gelen'));
            if (lastApproved) cards.push(_aiBuildFeedCard(lastApproved, 'gelen',   'Son Onaylanan'));
        }

        _aiFeedData[tab] = cards;
        renderAiFeed();
    } catch (err) {
        console.error('loadAiFeedData:', err);
    }
}


async function _aiFetchLastPending(direction) {
    try {
        const params = new URLSearchParams();
        if (direction) params.set('direction', direction);
        params.set('page', '1');
        params.set('limit', '1');
        const res = await fetch(`/api/invoices/pending?${params}`);
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.data || []);
        return list[0] || null;
    } catch (e) { return null; }
}


async function _aiFetchLastApproved(direction) {
    try {
        const params = new URLSearchParams();
        if (direction) params.set('direction', direction);
        params.set('page', '1');
        params.set('limit', '1');
        params.set('sort_by', 'invoice_date');
        params.set('sort_dir', 'desc');
        const res = await fetch(`/api/invoices?${params}`);
        const data = await res.json();
        return (data.data || [])[0] || null;
    } catch (e) { return null; }
}


function _aiBuildFeedCard(invoice, type, label) {
    return {
        id:        invoice.id,
        type,
        label,
        invoiceNo: invoice.invoice_no || '—',
        company:   invoice.companies?.name || 'Bilinmeyen',
        amount:    invoice.payable_amount_tl || 0,
        date:      invoice.invoice_date || '',
    };
}


function renderAiFeed() {
    const container = document.getElementById('aiFeedCards');
    if (!container) return;

    const cards = _aiFeedData[_aiActiveSession] || [];

    if (!cards.length) {
        container.innerHTML = '<div style="padding:8px 4px;font-size:11px;color:var(--fat-ink4);text-align:center;">Aktivite bulunamadı</div>';
        return;
    }

    container.innerHTML = cards.map(c => {
        const iconCls = c.type === 'pending' ? 'ti-clock'
                      : c.type === 'giden'   ? 'ti-arrow-up'
                      : 'ti-arrow-down';
        return `
            <div class="ai-feed-card" onclick="openFatDetailPage('${c.id}')">
                <div class="ai-feed-card-tag ai-feed-card-tag--${c.type}">
                    <i class="ti ${iconCls}"></i>${_aiEscape(c.label)}
                </div>
                <div class="ai-feed-card-row1">
                    <span class="ai-feed-card-no">${_aiEscape(c.invoiceNo)}</span>
                    <span class="ai-feed-card-company">${_aiEscape(c.company)}</span>
                </div>
                <div class="ai-feed-card-row2">
                    <span class="ai-feed-card-amount">₺ ${_aiFormatAmount(c.amount)}</span>
                    <span class="ai-feed-card-date">${_aiFormatRelativeDate(c.date)}</span>
                </div>
            </div>
        `;
    }).join('');
}


// ── UTILITIES ────────────────────────────────────────────────────────────────
function _aiEscape(str) {
    return String(str).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

function _aiFormatAmount(n) {
    n = parseFloat(n) || 0;
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000)     return Math.round(n / 1_000) + 'K';
    return n.toFixed(0);
}

function _aiFormatRelativeDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dayMs = 24 * 60 * 60 * 1000;
    const diffDays = Math.floor((today - d) / dayMs);

    if (diffDays <= 0)  return 'Bugün';
    if (diffDays === 1) return 'Dün';
    if (diffDays < 7)   return diffDays + ' gün önce';
    if (diffDays < 30)  return Math.floor(diffDays / 7) + ' hafta önce';
    return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

function _generateChatSuggestions() {
    const f = window._fatActiveFilters || {};
    const tab = _aiActiveSession;

    const suggestions = [];

    // If a company is filtered → suggest deeper drill-downs
    if (f.companies?.length) {
        const name = f.companies[0];
        suggestions.push(`${name}'nin bu ayki toplamı?`);
        suggestions.push(`${name}'den en büyük 5 fatura`);
        suggestions.push(`${name} ile geçen ayki durum`);
        return suggestions.slice(0, 3);
    }

    // If a date range is set → suggest analytical questions
    if (f.dateStart || f.dateEnd) {
        suggestions.push('Bu dönemin toplamı ne kadar?');
        suggestions.push('En pahalı 5 fatura');
        suggestions.push('Hangi firmalarla çalışıldı?');
        return suggestions.slice(0, 3);
    }

    // If a currency filter is set
    if (f.currency) {
        suggestions.push(`${f.currency} faturaların toplamı?`);
        suggestions.push(`En büyük ${f.currency} fatura?`);
        suggestions.push('Karşılaştır: TRY vs USD');
        return suggestions.slice(0, 3);
    }

    // If item filters (brand/category/product) set
    if (f.brands?.length || f.categories?.length) {
        const focus = f.brands?.[0] || f.categories?.[0];
        suggestions.push(`${focus} toplamı ne?`);
        suggestions.push(`En pahalı ${focus} fatura`);
        suggestions.push('Hangi firmalardan?');
        return suggestions.slice(0, 3);
    }

    // Default — no filters active
    if (tab === 'giden') {
        return ['En pahalı 5 satış', 'Bu ay en çok kime sattım?', 'Geçen ay ne kadardı?'];
    }
    if (tab === 'gelen') {
        return ['En pahalı 5 alış', 'Bu ay en çok kimden aldım?', 'Bu yılın toplamı?'];
    }
    return ['Bu ayki toplam?', 'En büyük fatura?', 'En aktif firma?'];
}
function _refreshChatSuggestions() {
    const container = document.getElementById('aiQuickPrompts');   // ← your actual ID
    if (!container) return;

    const suggestions = _generateChatSuggestions();

    if (!suggestions.length) {
        container.innerHTML = '';
        container.style.display = 'none';
        return;
    }

    container.style.display = '';   // reset any hide-when-empty
    container.innerHTML = suggestions.map(text => {
        // Escape single quotes so they don't break the onclick
        const safe = text.replace(/'/g, "\\'");
        return `<button class="ai-quick-prompt" onclick="_aiUseSuggestion('${safe}')">${_aiEscape(text)}</button>`;
    }).join('');

    const wrap = document.getElementById('aiQuickWrap');
    if (wrap?.classList.contains('ai-quick-wrap--collapsed')) {
        wrap.classList.add('ai-quick-wrap--new-content');
    }
}


function _aiUseSuggestion(text) {
    console.log('[suggestion clicked]:', text);
    const input = document.getElementById('aiInput');
    if (!input) { console.error('aiInput not found'); return; }
    input.value = text;
    aiSendMessage();
}
// ── UPDATED _aiStreamReply — adds action event handling ─────────────────────
async function _aiStreamReply(message, session, assistantMsg, bubble) {
    const history = session.slice(0, -2).map(m => ({ role: m.role, text: m.text }));

    const response = await fetch('/api/chat/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            tab: _aiActiveSession,
            message,
            history,
            filters: _getCurrentFilters(),
        }),
    });

    if (!response.ok || !response.body) {
        const errText = await response.text().catch(() => '');
        throw new Error(errText || `HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let firstToken = true;
    const messagesEl = document.getElementById('aiMessages');

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);

            let eventType = 'message';
            let dataStr = '';
            for (const line of block.split('\n')) {
                if (line.startsWith('event:'))     eventType = line.slice(6).trim();
                else if (line.startsWith('data:')) dataStr   = line.slice(5).trim();
            }
            if (!dataStr) continue;

            let data;
            try { data = JSON.parse(dataStr); } catch { continue; }

            if (eventType === 'token' && data.text) {
                if (firstToken) {
                    firstToken = false;
                    assistantMsg.streaming = false;
                    bubble?.classList.remove('ai-msg-bubble--streaming');
                }
                assistantMsg.text += data.text;
                if (bubble) bubble.innerHTML = _aiRenderMarkdown(assistantMsg.text);
                messagesEl.scrollTop = messagesEl.scrollHeight;

            } else if (eventType === 'tool_call') {
                // Optional: show a small "applying filter..." indicator
                console.log('[AI tool call]', data.name, data.args);

            } else if (eventType === 'action') {
                _handleAiAction(data.type, data.params);

            } else if (eventType === 'done') {
                assistantMsg.streaming = false;
                bubble?.classList.remove('ai-msg-bubble--streaming');
                //_refreshChatSuggestions()

            } else if (eventType === 'error') {
                throw new Error(data.message || 'Sunucu hatası');
            }
        }
    }

    assistantMsg.streaming = false;
    bubble?.classList.remove('ai-msg-bubble--streaming');
    _saveAiChatSessions()
}

function _aiRenderMarkdown(text) {
    if (!text) return '';
    try {
        // Custom renderer — force target=_blank on all links
        const renderer = new marked.Renderer();
        const originalLink = renderer.link.bind(renderer);
        renderer.link = (href, title, text) => {
            const html = originalLink(href, title, text);
            return html.replace(/^<a /, '<a target="_blank" rel="noopener noreferrer" ');
        };

        return marked.parse(text, {
            breaks: true,
            gfm: true,
            renderer,
        });
    } catch (e) {
        return _aiEscape(text);
    }
}
function _getCurrentFilters() {
    // Genel uses its own date range, no other filters
    if (_aiActiveSession === 'genel') {
        const ctx = window._gbCalCtx;
        if (ctx && ctx.selStart && ctx.selEnd) {
            return {
                dateStart: ctx.selStart.toISOString().slice(0, 10),
                dateEnd:   ctx.selEnd.toISOString().slice(0, 10),
            };
        }
        return {};
    }

    // Giden / Gelen use the main filter bar
    const f = window._fatActiveFilters || {};
    return {
        dateStart:      f.dateStart      || null,
        dateEnd:        f.dateEnd        || null,
        companies:      f.companies      || [],
        brands:         f.brands         || [],
        categories:     f.categories     || [],
        products:       f.products       || [],
        invoiceNumbers: f.invoiceNumbers || [],
        priceMin:       f.priceMin       ?? null,
        priceMax:       f.priceMax       ?? null,
        currency:       f.currency       || null,
    };
}

function _handleAiAction(type, params) {
    console.log('[dispatcher] type:', type, 'params:', params);
    switch (type) {
        case 'applyFilters':
            _applyFiltersFromAi(params || {});
            break;
    }
}


function _applyFiltersFromAi(params) {
    window._suppressFilterFetch = true;   // ← START batch

    try {
        // 1) Clear current filter state
        if (typeof clearAllFilters === 'function') clearAllFilters();
        window._fatActiveFilters = {};

        // 2) Restore tag filters with new values
        const setTags = (filter, list) => {
            if (!filter || !Array.isArray(list)) return;
            list.forEach(v => filter.add?.(v));
        };

        setTags(window._fatCompanyFilter,   params.companies);
        setTags(window._fatBrandFilter,     params.brands);
        setTags(window._fatCategoryFilter,  params.categories);
        setTags(window._fatProductFilter,   params.products);
        setTags(window._fatInvoiceNoFilter, params.invoiceNumbers);

        // 3) Date range
        if (params.dateStart || params.dateEnd) {
            const dsEl = document.getElementById('filterDateStart');
            const deEl = document.getElementById('filterDateEnd');
            if (dsEl) dsEl.value = params.dateStart || '';
            if (deEl) deEl.value = params.dateEnd   || '';

            if (params.dateStart && params.dateEnd) {
                window._fatCalCtx.selStart = new Date(params.dateStart);
                window._fatCalCtx.selEnd   = new Date(params.dateEnd);
                if (typeof buildFilterCals === 'function') buildFilterCals();
                const disp = document.getElementById('dateDisplay');
                if (disp) {
                    const fmt = dt => dt.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
                    disp.textContent = `${fmt(window._fatCalCtx.selStart)} – ${fmt(window._fatCalCtx.selEnd)}`;
                }
                document.getElementById('datePill')?.classList.add('active');
            }
        }

        // 4) Price
        if (params.priceMin != null) window._fatPriceMin = params.priceMin;
        if (params.priceMax != null) window._fatPriceMax = params.priceMax;
        if ((params.priceMin != null || params.priceMax != null) &&
            typeof updateFilterPriceSlider === 'function') {
            updateFilterPriceSlider();
        }

        // 5) Currency
        if (params.currency) {
            const sel = document.getElementById('filterCurrency');
            if (sel) sel.value = params.currency;
        }

        if (params.sortBy) {
            // Map AI-friendly names to your internal col names
            const colMap = {
                date:       'date',
                amount:     'total',
                company:    'company',
                invoice_no: 'invoice_no',
            };

            const internalCol = colMap[params.sortBy] || 'date';
            const dir = params.sortDir || 'desc';

            fatListSort = { col: internalCol, dir };
        }

    } finally {
        window._suppressFilterFetch = false;   // ← END batch (in finally so it clears even on error)
    }

    // 6) Single fetch at the end — now runs freely
    if (typeof applyFiltersAndFetch === 'function') applyFiltersAndFetch();
    if (typeof updateAdvancedBadge  === 'function') updateAdvancedBadge();
}

function _saveAiChatSessions() {
    try {
        sessionStorage.setItem('ai_chat_messages', JSON.stringify(_aiChatSessions));
    } catch (e) {}
}

// ── INIT — Enter key + initial render ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Restore chat sessions
    try {
        const saved = sessionStorage.getItem('ai_chat_messages');
        if (saved) {
            const parsed = JSON.parse(saved);
            // Merge — keep default initial messages for tabs that don't have saved data
            for (const tab of ['genel', 'giden', 'gelen']) {
                if (parsed[tab] && parsed[tab].length) {
                    _aiChatSessions[tab] = parsed[tab].map(m => ({
                        ...m,
                        streaming: false,  // never restore streaming state
                    }));
                }
            }
        }
    } catch (e) {}


    const input = document.getElementById('aiInput');
    if (input) {
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                aiSendMessage();
            }
        });
    }
    renderAiChat();
});




