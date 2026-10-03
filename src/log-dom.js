export function reconcileLogEntries(container, entries, view, createEntry, updateEntry) {
  const reusableEntries = new Map();

  if (container.dataset.view === view) {
    for (const element of container.querySelectorAll("[data-entry-id]")) {
      reusableEntries.set(element.dataset.entryId, element);
    }
  }

  container.dataset.view = view;
  const nextElements = entries.map((entry) => {
    const existing = reusableEntries.get(entry.id);
    if (!existing) {
      return createEntry(entry);
    }
    updateEntry?.(existing, entry);
    return existing;
  });
  container.replaceChildren(...nextElements);
  return nextElements;
}
