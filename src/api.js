const API = (() => {
  async function getAlerts() {
    const res = await fetch('/api/web/alerts');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function createAlert(payload) {
    const res = await fetch('/api/web/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function deleteAlert(alertId) {
    const res = await fetch(`/api/web/alerts/${alertId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  return { getAlerts, createAlert, deleteAlert };
})();

if (typeof module !== 'undefined') module.exports = API;
