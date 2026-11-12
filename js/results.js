export function formatTime(seconds, precision = 1) {
  const factor = 10 ** precision;
  const ticks = Math.round(Math.max(0, seconds) * factor);
  const minutes = Math.floor(ticks / (60 * factor));
  const rest = (ticks % (60 * factor)) / factor;
  return `${String(minutes).padStart(2, '0')}:${rest.toFixed(precision).padStart(precision + 3, '0')}`;
}

export function createResults({ dialog, onReplay, onNext, onDismiss }) {
  const $ = id => dialog.querySelector(`#${id}`);
  $('again').addEventListener('click', onReplay);
  $('next').addEventListener('click', onNext);
  dialog.addEventListener('close', onDismiss);
  // A completed run stays on its scoreboard until replay or progression.
  dialog.addEventListener('cancel', event => event.preventDefault());
  return {
    show({ level, result, rows, totalLevels = 5 }) {
      const final = level.id === totalLevels;
      $('result-heading').textContent = final ? 'All five, cleared.' : `Level ${String(level.id).padStart(2, '0')}, cleared.`;
      $('result-time').textContent = formatTime(result.seconds, 2);
      $('record-scope').textContent = result.persisted ? 'Saved in this browser' : 'Saved for this visit';
      $('next').textContent = final ? 'Start again' : 'Next level';
      const body = $('result-scores');
      body.replaceChildren();
      rows.forEach((run, index) => {
        const row = document.createElement('li');
        const rank = document.createElement('span');
        rank.className = 'score-rank';
        rank.textContent = String(index + 1).padStart(2, '0');
        const time = document.createElement('span');
        time.className = 'score-time';
        time.textContent = formatTime(run.seconds, 2);
        row.classList.toggle('is-current', run.id === result.run.id);
        row.append(rank, time);
        body.append(row);
      });
      if (!dialog.open) dialog.showModal();
      $('next').focus({ preventScroll: true });
    },
    hide() { if (dialog.open) dialog.close(); },
    get open() { return dialog.open; },
  };
}
