/* Shared published rankings. One request per page, with browser cache revalidation. */
window.DynastyRankings = (() => {
  let pending;
  const types = ["competing", "overall", "tanking"];

  function load() {
    if (!pending) {
      pending = fetch("/data/nfl_rankings.json", { cache: "no-cache" })
        .then(response => {
          if (!response.ok) throw new Error(`Rankings request failed (${response.status})`);
          return response.json();
        })
        .then(data => {
          if (data.schemaVersion !== 1 || !data.version || !Number.isFinite(Date.parse(data.publishedAt)) ||
              !types.every(type => Array.isArray(data.rankings?.[type]) && data.rankings[type].length >= 100 &&
                data.rankings[type].every(row => ["Rank", "Player", "Position", "Age", "Score"].every(key => typeof row[key] === "string")))) {
            throw new Error("The published rankings file is incomplete or unsupported.");
          }
          document.querySelectorAll("[data-rankings-status]").forEach(el => {
            el.textContent = `Rankings published ${new Date(data.publishedAt).toLocaleDateString()}`;
          });
          return data;
        })
        .catch(error => {
          pending = undefined; // A later user action can retry a failed request.
          document.querySelectorAll("[data-rankings-status]").forEach(el => {
            el.textContent = "Rankings could not load. Please refresh to try again.";
          });
          throw error;
        });
    }
    return pending;
  }

  async function getRows(type) {
    if (!types.includes(type)) throw new Error(`Unknown ranking type: ${type}`);
    const data = await load();
    // Consumers may sort or annotate their copy without changing another view's source data.
    return data.rankings[type].map(row => ({ ...row }));
  }

  return Object.freeze({ getRows });
})();
