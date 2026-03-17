export function renderUI(): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>smoke-signal</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #f5f5f5; color: #222; padding: 1.5rem; max-width: 900px; margin: 0 auto; }
    h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
    h2 { font-size: 1.1rem; margin: 1.5rem 0 0.75rem; }
    .subtitle { color: #666; font-size: 0.85rem; margin-bottom: 1.5rem; }
    .status-bar { display: flex; gap: 1.5rem; background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 0.75rem 1rem; margin-bottom: 1.5rem; font-size: 0.85rem; }
    .status-bar span { color: #666; }
    .status-bar strong { color: #222; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #ddd; border-radius: 8px; overflow: hidden; font-size: 0.875rem; }
    th { text-align: left; padding: 0.6rem 0.75rem; background: #f0f0f0; font-weight: 600; color: #555; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.03em; }
    td { padding: 0.6rem 0.75rem; border-top: 1px solid #eee; vertical-align: top; }
    tr:hover td { background: #fafafa; }
    .btn { display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.35rem 0.75rem; border-radius: 6px; border: none; cursor: pointer; font-size: 0.8rem; font-weight: 500; }
    .btn-danger { background: #fee2e2; color: #b91c1c; }
    .btn-danger:hover { background: #fecaca; }
    .btn-primary { background: #2563eb; color: #fff; }
    .btn-primary:hover { background: #1d4ed8; }
    .card { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; }
    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
    .form-group { display: flex; flex-direction: column; gap: 0.25rem; }
    .form-group.full { grid-column: 1 / -1; }
    label { font-size: 0.8rem; font-weight: 500; color: #555; }
    input, select { padding: 0.4rem 0.6rem; border: 1px solid #ccc; border-radius: 6px; font-size: 0.875rem; width: 100%; }
    input:focus, select:focus { outline: 2px solid #2563eb; border-color: transparent; }
    .form-actions { grid-column: 1 / -1; display: flex; justify-content: flex-end; margin-top: 0.25rem; }
    .empty { color: #999; font-size: 0.875rem; padding: 1rem 0; }
    .tag { display: inline-block; background: #e0f2fe; color: #0369a1; border-radius: 4px; padding: 0.15rem 0.4rem; font-size: 0.75rem; }
    #toast { position: fixed; bottom: 1.5rem; right: 1.5rem; background: #1e293b; color: #fff; padding: 0.6rem 1rem; border-radius: 8px; font-size: 0.875rem; opacity: 0; transition: opacity 0.2s; pointer-events: none; }
    #toast.show { opacity: 1; }
    @media (max-width: 600px) { .form-grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <h1>🏕 smoke-signal</h1>
  <p class="subtitle">Campsite availability watchdog</p>

  <div class="status-bar" id="status-bar">
    <div><span>Active watches: </span><strong id="s-watches">—</strong></div>
    <div><span>Snapshots: </span><strong id="s-snapshots">—</strong></div>
    <div><span>Notifications (24h): </span><strong id="s-notifs">—</strong></div>
  </div>

  <h2>Active Watches</h2>
  <table id="watches-table">
    <thead>
      <tr>
        <th>Facility</th>
        <th>Dates</th>
        <th>Filters</th>
        <th>Added</th>
        <th></th>
      </tr>
    </thead>
    <tbody id="watches-body">
      <tr><td colspan="5" class="empty">Loading…</td></tr>
    </tbody>
  </table>

  <h2>Add Watch</h2>
  <div class="card">
    <form id="watch-form">
      <div class="form-grid">
        <div class="form-group">
          <label for="facility_id">Facility ID *</label>
          <input id="facility_id" name="facility_id" placeholder="e.g. 232450" required />
        </div>
        <div class="form-group">
          <label for="facility_name">Facility Name</label>
          <input id="facility_name" name="facility_name" placeholder="e.g. Lower Pines" />
        </div>
        <div class="form-group">
          <label for="start_date">Start Date *</label>
          <input id="start_date" name="start_date" type="date" required />
        </div>
        <div class="form-group">
          <label for="end_date">End Date *</label>
          <input id="end_date" name="end_date" type="date" required />
        </div>
        <div class="form-group">
          <label for="loop_name">Loop Name</label>
          <input id="loop_name" name="loop_name" placeholder="e.g. North Pines (optional)" />
        </div>
        <div class="form-group">
          <label for="site_types">Site Types</label>
          <input id="site_types" name="site_types" placeholder="e.g. STANDARD NONELECTRIC (optional)" />
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Add Watch</button>
        </div>
      </div>
    </form>
  </div>

  <h2>Reminders</h2>
  <table id="reminders-table">
    <thead>
      <tr>
        <th>Facility</th>
        <th>Target Date</th>
        <th>Window Opens</th>
        <th>Alert Before</th>
        <th></th>
      </tr>
    </thead>
    <tbody id="reminders-body">
      <tr><td colspan="5" class="empty">Loading…</td></tr>
    </tbody>
  </table>

  <h2>Add Reminder</h2>
  <div class="card">
    <form id="reminder-form">
      <div class="form-grid">
        <div class="form-group">
          <label for="r_facility_id">Facility ID *</label>
          <input id="r_facility_id" name="facility_id" placeholder="e.g. 232450" required />
        </div>
        <div class="form-group">
          <label for="r_facility_name">Facility Name</label>
          <input id="r_facility_name" name="facility_name" placeholder="e.g. Lower Pines" />
        </div>
        <div class="form-group">
          <label for="r_target_date">First Night *</label>
          <input id="r_target_date" name="target_date" type="date" required />
        </div>
        <div class="form-group">
          <label for="r_nights">Nights</label>
          <input id="r_nights" name="nights" type="number" min="1" value="1" />
        </div>
        <div class="form-group">
          <label for="r_window_months">Booking Window (months)</label>
          <input id="r_window_months" name="window_months" type="number" min="1" value="6" />
        </div>
        <div class="form-group">
          <label for="r_remind_days">Alert N Days Before Window Opens</label>
          <input id="r_remind_days" name="remind_days_before" type="number" min="0" value="3" />
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Add Reminder</button>
        </div>
      </div>
    </form>
  </div>

  <div id="toast"></div>

  <script>
    const toast = (msg, err) => {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.style.background = err ? '#7f1d1d' : '#1e293b';
      el.classList.add('show');
      setTimeout(() => el.classList.remove('show'), 3000);
    };

    const fmt = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    const fmtAdded = (ts) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    async function loadStatus() {
      const s = await fetch('/api/status').then(r => r.json());
      document.getElementById('s-watches').textContent = s.active_watches;
      document.getElementById('s-snapshots').textContent = s.total_snapshots.toLocaleString();
      document.getElementById('s-notifs').textContent = s.notifications_last_24h;
    }

    async function loadWatches() {
      const watches = await fetch('/api/watches').then(r => r.json());
      const body = document.getElementById('watches-body');
      if (!watches.length) {
        body.innerHTML = '<tr><td colspan="5" class="empty">No active watches</td></tr>';
        return;
      }
      body.innerHTML = watches.map(w => {
        const filters = [
          w.loop_name ? '<span class="tag">loop: ' + w.loop_name + '</span>' : '',
          w.site_types ? JSON.parse(w.site_types).map(t => '<span class="tag">' + t + '</span>').join(' ') : '',
        ].filter(Boolean).join(' ') || '—';
        return \`<tr>
          <td><strong>\${w.facility_name || w.facility_id}</strong><br><small style="color:#888">\${w.facility_id}</small></td>
          <td>\${fmt(w.start_date)} – \${fmt(w.end_date)}</td>
          <td>\${filters}</td>
          <td>\${fmtAdded(w.created_at)}</td>
          <td><button class="btn btn-danger" onclick="deleteWatch(\${w.id})">Remove</button></td>
        </tr>\`;
      }).join('');
    }

    async function loadReminders() {
      const reminders = await fetch('/api/reminders').then(r => r.json());
      const body = document.getElementById('reminders-body');
      if (!reminders.length) {
        body.innerHTML = '<tr><td colspan="5" class="empty">No pending reminders</td></tr>';
        return;
      }
      body.innerHTML = reminders.map(r => {
        const windowDate = new Date(r.target_date + 'T00:00:00Z');
        windowDate.setUTCMonth(windowDate.getUTCMonth() - r.window_months);
        const windowFmt = windowDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
        return \`<tr>
          <td><strong>\${r.facility_name || r.facility_id}</strong></td>
          <td>\${fmt(r.target_date)} (\${r.nights}n)</td>
          <td>\${windowFmt}</td>
          <td>\${r.remind_days_before} days</td>
          <td><button class="btn btn-danger" onclick="deleteReminder(\${r.id})">Remove</button></td>
        </tr>\`;
      }).join('');
    }

    async function deleteWatch(id) {
      await fetch('/api/watches/' + id, { method: 'DELETE' });
      toast('Watch removed');
      loadWatches();
      loadStatus();
    }

    async function deleteReminder(id) {
      await fetch('/api/reminders/' + id, { method: 'DELETE' });
      toast('Reminder removed');
      loadReminders();
    }

    document.getElementById('watch-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = {
        facility_id: fd.get('facility_id'),
        facility_name: fd.get('facility_name') || undefined,
        start_date: fd.get('start_date'),
        end_date: fd.get('end_date'),
        loop_name: fd.get('loop_name') || undefined,
        site_types: fd.get('site_types') ? [fd.get('site_types').trim()] : undefined,
      };
      const res = await fetch('/api/watches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) {
        toast('Watch added');
        e.target.reset();
        loadWatches();
        loadStatus();
      } else {
        const err = await res.json();
        toast(err.error || 'Error', true);
      }
    });

    document.getElementById('reminder-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = {
        facility_id: fd.get('facility_id'),
        facility_name: fd.get('facility_name') || undefined,
        target_date: fd.get('target_date'),
        nights: Number(fd.get('nights')),
        window_months: Number(fd.get('window_months')),
        remind_days_before: Number(fd.get('remind_days_before')),
      };
      const res = await fetch('/api/reminders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) {
        toast('Reminder added');
        e.target.reset();
        loadReminders();
      } else {
        const err = await res.json();
        toast(err.error || 'Error', true);
      }
    });

    loadStatus();
    loadWatches();
    loadReminders();
  </script>
</body>
</html>`;
}
