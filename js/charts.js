/* ============================================================
   charts.js — Analytics charts (rebuilt clean — your live deploy
   had a broken object literal here, `{ // comment \n const x...`,
   which crashed the whole script and caused the blank white screen)
   ============================================================ */

const _charts = {};

function renderAnalyticsCharts() {
    const vCtx = document.getElementById('vaultDoughnutChart');
    if (!vCtx) return; // Not on DOM yet

    Chart.defaults.color = '#64748b';
    Chart.defaults.font.family = "'Inter', sans-serif";

    const tooltipConfig = {
        backgroundColor: '#1e293b',
        titleColor: '#fff',
        bodyColor: '#fff',
        padding: 10,
        cornerRadius: 8,
        displayColors: false
    };

    // 1. Vault Distribution Doughnut
    const vData = [state.wallet.cash, state.wallet.online];
    if (_charts.vault) {
        _charts.vault.data.datasets[0].data = vData;
        _charts.vault.update();
    } else {
        _charts.vault = new Chart(vCtx, {
            type: 'doughnut',
            data: { labels: ['Cash Vault', 'Online Vault'], datasets: [{ data: vData, backgroundColor: ['rgba(16, 185, 129, 0.85)', 'rgba(249, 115, 22, 0.85)'], borderWidth: 0, hoverOffset: 4 }] },
            options: { responsive: true, maintainAspectRatio: false, cutout: '75%', plugins: { legend: { position: 'bottom', labels: { padding: 15, usePointStyle: true } }, tooltip: tooltipConfig } }
        });
    }

    // 2. Portfolio Health Pie
    let actAmt = 0, paidAmt = 0;
    state.loans.forEach(l => { if (l.status === 'Active') actAmt += l.amount; else paidAmt += l.amount; });
    const sData = [actAmt, paidAmt];
    const sCtx = document.getElementById('loanStatusPieChart');
    if (_charts.status) {
        _charts.status.data.datasets[0].data = sData;
        _charts.status.update();
    } else {
        _charts.status = new Chart(sCtx, {
            type: 'pie',
            data: { labels: ['Active Loans', 'Paid / Closed'], datasets: [{ data: sData, backgroundColor: ['rgba(245, 158, 11, 0.85)', 'rgba(16, 185, 129, 0.85)'], borderWidth: 0, hoverOffset: 4 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { padding: 15, usePointStyle: true } }, tooltip: tooltipConfig } }
        });
    }

    // 3. Top Active Clients Bar
    const actLoans = state.loans.filter(l => l.status === 'Active').sort((a, b) => b.amount - a.amount).slice(0, 5);
    const cLabels = actLoans.length ? actLoans.map(l => l.name) : ['No Active Clients'];
    const cData = actLoans.length ? actLoans.map(l => l.amount) : [0];
    const cCtx = document.getElementById('topClientsBarChart');
    if (_charts.clients) {
        _charts.clients.data.labels = cLabels;
        _charts.clients.data.datasets[0].data = cData;
        _charts.clients.update();
    } else {
        _charts.clients = new Chart(cCtx, {
            type: 'bar',
            data: { labels: cLabels, datasets: [{ label: 'Principal', data: cData, backgroundColor: 'rgba(249, 115, 22, 0.85)', borderRadius: 6, maxBarThickness: 40 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { ...tooltipConfig, callbacks: { label: c => ' ₹' + c.parsed.y.toLocaleString('en-IN') } } }, scales: { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { callback: v => '₹' + (v >= 1000 ? v / 1000 + 'k' : v) } }, x: { grid: { display: false } } } }
        });
    }

    // 4. 7-Day Cashflow Trend Area
    const last7Days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); d.setHours(0, 0, 0, 0); return d; });
    const incData = [0, 0, 0, 0, 0, 0, 0], expData = [0, 0, 0, 0, 0, 0, 0];

    state.logs.forEach(log => {
        const logDate = new Date(log.timestampMs); logDate.setHours(0, 0, 0, 0);
        last7Days.forEach((day, idx) => {
            if (day.getTime() === logDate.getTime()) {
                const amt = parseFloat((log.impactStr || '').replace(/[^0-9.-]+/g, '')) || 0;
                if (log.typeClass === 'income') incData[idx] += amt;
                if (log.typeClass === 'expense') expData[idx] += Math.abs(amt);
            }
        });
    });

    const cfLabels = last7Days.map(d => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }));
    const cfCtx = document.getElementById('cashflowLineChart');

    if (_charts.cashflow) {
        _charts.cashflow.data.labels = cfLabels;
        _charts.cashflow.data.datasets[0].data = incData;
        _charts.cashflow.data.datasets[1].data = expData;
        _charts.cashflow.update();
    } else {
        _charts.cashflow = new Chart(cfCtx, {
            type: 'line',
            data: {
                labels: cfLabels, datasets: [
                    { label: 'Income', data: incData, borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 3 },
                    { label: 'Expense', data: expData, borderColor: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.1)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 3 }
                ]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 8 } }, tooltip: { ...tooltipConfig, mode: 'index', intersect: false, callbacks: { label: c => ' ' + c.dataset.label + ': ₹' + c.parsed.y.toLocaleString('en-IN') } } }, scales: { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { callback: v => '₹' + (v >= 1000 ? v / 1000 + 'k' : v) } }, x: { grid: { display: false } } }, interaction: { mode: 'nearest', axis: 'x', intersect: false } }
        });
    }

    // 5. Pending Dues by Client (Bar)
    let overdueClients = [];
    const pdToday = new Date(); pdToday.setHours(0, 0, 0, 0);
    state.loans.forEach(l => {
        if (l.status === 'Active') {
            const isOverdue = l.dueDate ? new Date(l.dueDate) < pdToday : false;
            const pendingHist = (l.history || []).filter(h => h.status === 'Pending').reduce((sum, h) => sum + (Number(h.amount) || 0), 0);
            let cAmt = pendingHist + (isOverdue ? l.amount : 0);
            if (cAmt > 0) overdueClients.push({ name: l.name, amt: cAmt });
        }
    });
    overdueClients = overdueClients.sort((a, b) => b.amt - a.amt).slice(0, 5);
    const pLabels = overdueClients.length ? overdueClients.map(c => c.name) : ['No Pending Dues'];
    const pData = overdueClients.length ? overdueClients.map(c => c.amt) : [0];
    const pCtx = document.getElementById('pendingDuesChart');

    if (_charts.pending) {
        _charts.pending.data.labels = pLabels;
        _charts.pending.data.datasets[0].data = pData;
        _charts.pending.update();
    } else if (pCtx) {
        _charts.pending = new Chart(pCtx, {
            type: 'bar',
            data: { labels: pLabels, datasets: [{ label: 'Pending Amount', data: pData, backgroundColor: 'rgba(239, 68, 68, 0.85)', borderRadius: 6, maxBarThickness: 40 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { ...tooltipConfig, callbacks: { label: c => ' ₹' + c.parsed.y.toLocaleString('en-IN') } } }, scales: { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { callback: v => '₹' + (v >= 1000 ? v / 1000 + 'k' : v) } }, x: { grid: { display: false } } } }
        });
    }

    // 6. Client Size Distribution (Doughnut)
    let cBuckets = { 'Micro (<10k)': 0, 'Small (10k-50k)': 0, 'Medium (50k-1L)': 0, 'Large (>1L)': 0 };
    state.loans.forEach(l => {
        if (l.status === 'Active') {
            if (l.amount < 10000) cBuckets['Micro (<10k)'] += l.amount;
            else if (l.amount <= 50000) cBuckets['Small (10k-50k)'] += l.amount;
            else if (l.amount <= 100000) cBuckets['Medium (50k-1L)'] += l.amount;
            else cBuckets['Large (>1L)'] += l.amount;
        }
    });
    const csLabels = Object.keys(cBuckets);
    const csData = Object.values(cBuckets);
    const csCtx = document.getElementById('clientSizeChart');

    if (_charts.clientSize) {
        _charts.clientSize.data.datasets[0].data = csData;
        _charts.clientSize.update();
    } else if (csCtx) {
        _charts.clientSize = new Chart(csCtx, {
            type: 'doughnut',
            data: { labels: csLabels, datasets: [{ data: csData, backgroundColor: ['rgba(249, 115, 22, 0.85)', 'rgba(16, 185, 129, 0.85)', 'rgba(245, 158, 11, 0.85)', 'rgba(234, 88, 12, 0.85)'], borderWidth: 0, hoverOffset: 4 }] },
            options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'bottom', labels: { padding: 15, usePointStyle: true } }, tooltip: tooltipConfig } }
        });
    }
}
