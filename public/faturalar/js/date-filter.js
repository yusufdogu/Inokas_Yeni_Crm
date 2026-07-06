// ─── Generic calendar module ─────────────────────────────────────────────────
// Each context = { selStart, selEnd, viewMonth, viewMonth2, cal1Id, cal2Id,
//                  pickHandler, calChangeHandler, firstYear, onRangeComplete }

const _CAL_DOWS   = ['Pts','Sal','Çar','Per','Cum','Cts','Paz'];
const _CAL_MONTHS = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];

function buildCals(ctx) {
    if (
        ctx.viewMonth2.year < ctx.viewMonth.year ||
        (ctx.viewMonth2.year === ctx.viewMonth.year && ctx.viewMonth2.month <= ctx.viewMonth.month)
    ) {
        ctx.viewMonth2 = ctx.viewMonth.month === 11
            ? { year: ctx.viewMonth.year + 1, month: 0 }
            : { year: ctx.viewMonth.year, month: ctx.viewMonth.month + 1 };
    }
    _buildOneCal(ctx, ctx.cal1Id, ctx.viewMonth.year,  ctx.viewMonth.month,  1);
    _buildOneCal(ctx, ctx.cal2Id, ctx.viewMonth2.year, ctx.viewMonth2.month, 2);
}

function _buildOneCal(ctx, containerId, year, month, calIdx) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const today = new Date(); today.setHours(0, 0, 0, 0);

    let startDow = new Date(year, month, 1).getDay();
    startDow = startDow === 0 ? 6 : startDow - 1;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    let monthOpts = '';
    _CAL_MONTHS.forEach((m, i) => {
        const disabled = year === today.getFullYear() && i > today.getMonth();
        if (!disabled) monthOpts += `<option value="${i}"${i === month ? ' selected' : ''}>${m}</option>`;
    });

    let yearOpts = '';
    for (let y = today.getFullYear(); y >= (ctx.firstYear || 2020); y--) {
        yearOpts += `<option value="${y}"${y === year ? ' selected' : ''}>${y}</option>`;
    }

    let html = `<div class="filter-cal-header">
        <select class="filter-cal-select" onchange="${ctx.calChangeHandler}(${calIdx},'month',this.value)">${monthOpts}</select>
        <select class="filter-cal-select" onchange="${ctx.calChangeHandler}(${calIdx},'year',this.value)">${yearOpts}</select>
    </div>
    <div class="filter-cal-grid">`;

    _CAL_DOWS.forEach(d => { html += `<div class="filter-cal-dow">${d}</div>`; });
    for (let i = 0; i < startDow; i++) html += `<div class="filter-cal-day other"></div>`;

    for (let d = 1; d <= daysInMonth; d++) {
        const dt = new Date(year, month, d);
        const isFuture   = dt > today;
        const isToday    = dt.getTime() === today.getTime();
        const isSel      = (ctx.selStart && dt.getTime() === ctx.selStart.getTime()) ||
                           (ctx.selEnd   && dt.getTime() === ctx.selEnd.getTime());
        const isInRange  = ctx.selStart && ctx.selEnd && dt > ctx.selStart && dt < ctx.selEnd;

        let cls = 'filter-cal-day';
        if (isFuture)       cls += ' future';
        else if (isSel)     cls += ' sel';
        else if (isInRange) cls += ' inrange';
        if (isToday && !isSel) cls += ' today';

        const onclick = isFuture ? '' : `onclick="${ctx.pickHandler}(${year},${month},${d})"`;
        html += `<div class="${cls}" ${onclick}>${d}</div>`;
    }

    html += `</div>`;
    el.innerHTML = html;
}

function onCalChange(ctx, calIdx, type, val) {
    val = parseInt(val);
    if (calIdx === 1) {
        if (type === 'month') ctx.viewMonth.month = val;
        else ctx.viewMonth.year = val;
        if (
            ctx.viewMonth.year > ctx.viewMonth2.year ||
            (ctx.viewMonth.year === ctx.viewMonth2.year && ctx.viewMonth.month >= ctx.viewMonth2.month)
        ) {
            ctx.viewMonth2 = ctx.viewMonth.month === 11
                ? { year: ctx.viewMonth.year + 1, month: 0 }
                : { year: ctx.viewMonth.year, month: ctx.viewMonth.month + 1 };
        }
    } else {
        if (type === 'month') ctx.viewMonth2.month = val;
        else ctx.viewMonth2.year = val;
        if (
            ctx.viewMonth2.year < ctx.viewMonth.year ||
            (ctx.viewMonth2.year === ctx.viewMonth.year && ctx.viewMonth2.month <= ctx.viewMonth.month)
        ) {
            ctx.viewMonth = ctx.viewMonth2.month === 0
                ? { year: ctx.viewMonth2.year - 1, month: 11 }
                : { year: ctx.viewMonth2.year, month: ctx.viewMonth2.month - 1 };
        }
    }
    buildCals(ctx);
}

function pickCalDay(ctx, y, m, d) {
    const dt = new Date(y, m, d);
    if (!ctx.selStart || ctx.selEnd) {
        ctx.selStart = dt;
        ctx.selEnd   = null;
    } else if (dt < ctx.selStart) {
        ctx.selEnd   = ctx.selStart;
        ctx.selStart = dt;
    } else {
        ctx.selEnd = dt;
    }

    buildCals(ctx);

    if (ctx.selStart && ctx.selEnd && typeof ctx.onRangeComplete === 'function') {
        ctx.onRangeComplete(ctx.selStart, ctx.selEnd);
    }
}