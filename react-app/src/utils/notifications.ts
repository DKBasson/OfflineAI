export function requestNotificationPermission(): void {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

export function notifyComplete(title: string, body: string): void {
  if (
    'Notification' in window &&
    Notification.permission === 'granted' &&
    document.hidden
  ) {
    try {
      new Notification(title, { body, icon: '/favicon.svg' });
    } catch {
      // Notification API not available
    }
  }
}
