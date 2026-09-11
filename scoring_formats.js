/* Shared dynasty-value adjustments. Half-PPR Superflex is the source baseline. */
(function (root) {
  'use strict';
  function score(value, position, format = {}) {
    let result = Number.parseFloat(value) || 0;
    if (position === 'WR' || position === 'TE') result *= format.ppr === 'std' ? .95 : format.ppr === 'ppr' ? 1.05 : 1;
    if (position === 'TE' && format.tePremium) result *= 1.05;
    if (position === 'QB' && format.superflex === false) result *= .65;
    return result;
  }
  function read(doc = document) {
    return {ppr: doc.getElementById('nonPpr').checked ? 'std' : doc.getElementById('fullPpr').checked ? 'ppr' : 'hppr',
      superflex: doc.getElementById('superflex').checked, tePremium: doc.getElementById('tePremium').checked};
  }
  function bind(onChange, doc = document) {
    const ppr = ['nonPpr','halfPpr','fullPpr'].map(id => doc.getElementById(id));
    ppr.forEach(control => control.addEventListener('change', () => {
      if (control.checked) ppr.filter(other => other !== control).forEach(other => {other.checked = false;});
      if (!ppr.some(other => other.checked)) doc.getElementById('halfPpr').checked = true;
      onChange();
    }));
    ['superflex','tePremium'].forEach(id => doc.getElementById(id).addEventListener('change', onChange));
  }
  const api = {score, read, bind};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DynastyScoring = api;
})(globalThis);
