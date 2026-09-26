// Only an opaque thread selector is stored in the tab. Message content stays on the server.
type ThreadStorage = Pick<Storage, "getItem" | "setItem">;
const keyFor = (scope: string) => `job-os-active:${scope}`;

export function readActiveConversation(scope: string, storage: ThreadStorage): string {
  const saved = storage.getItem(keyFor(scope));
  return saved && new RegExp(`^${scope}:\\d{10,13}$`).test(saved) ? saved : scope;
}

export function saveActiveConversation(scope: string, thread: string, storage: ThreadStorage): void {
  if (thread !== scope && !new RegExp(`^${scope}:\\d{10,13}$`).test(thread)) {
    throw new Error("Thread does not belong to this conversation scope");
  }
  storage.setItem(keyFor(scope), thread);
}
