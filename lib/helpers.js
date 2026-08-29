/**
 * Helpers — shared utilities.
 */
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(s) {
  if (!s) return '';
  try {
    return new Date(s).toLocaleDateString('ar', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return s;
  }
}

function formatDateTime(s) {
  if (!s) return '';
  try {
    return new Date(s).toLocaleString('ar', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return s;
  }
}

function statusLabel(s) {
  const map = {
    SCHEDULED: 'قادمة',
    LIVE: 'مباشرة',
    FINISHED: 'منتهية',
    POSTPONED: 'مؤجلة',
    CANCELLED: 'ملغاة',
    UPCOMING: 'قادمة',
    ACTIVE: 'نشطة',
    ARCHIVED: 'مؤرشفة',
  };
  return map[s] || s;
}

function statusClass(s) {
  const map = {
    SCHEDULED: 'bg-blue-100 text-blue-700',
    LIVE: 'bg-red-100 text-red-700 ring-1 ring-red-300',
    FINISHED: 'bg-slate-100 text-slate-700',
    POSTPONED: 'bg-amber-100 text-amber-700',
    CANCELLED: 'bg-slate-200 text-slate-500 line-through',
    UPCOMING: 'bg-blue-100 text-blue-700',
    ACTIVE: 'bg-emerald-100 text-emerald-700',
    ARCHIVED: 'bg-slate-100 text-slate-700',
  };
  return map[s] || 'bg-slate-100 text-slate-700';
}

module.exports = { escapeHtml, formatDate, formatDateTime, statusLabel, statusClass };
