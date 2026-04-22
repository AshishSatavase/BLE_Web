'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type Alert = {
  messageId: string;
  senderId: string;
  senderNickname: string;
  content: string;
  timestamp: string;
  latitude: number | null;
  longitude: number | null;
};

const ALERTS_API_URL = 'https://ble-backend-pn2k.onrender.com/api/alerts';
const HEALTH_API_URL = 'https://ble-backend-pn2k.onrender.com/api/health';

type Toast = {
  id: string;
  text: string;
};

export default function DashboardPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [backendOnline, setBackendOnline] = useState(false);
  const [expandedAlertId, setExpandedAlertId] = useState<string | null>(null);
  const [deletingAlertId, setDeletingAlertId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const isInitialLoadRef = useRef(true);

  const headerStatus = useMemo(
    () => (backendOnline ? 'Backend Online' : 'Backend Offline'),
    [backendOnline]
  );

  useEffect(() => {
    const cleanupLegacyServiceWorker = async () => {
      if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
        return;
      }
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((key) => caches.delete(key)));
        }
      } catch {
        // Ignore cleanup failures. Polling still works without this.
      }
    };

    cleanupLegacyServiceWorker();
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setTimeout(() => {
      setToasts((prev) => prev.slice(1));
    }, 3500);
    return () => clearTimeout(timer);
  }, [toasts]);

  useEffect(() => {
    let mounted = true;

    const tick = async () => {
      try {
        const healthRes = await fetch(HEALTH_API_URL, { cache: 'no-store' });
        if (!mounted) return;
        setBackendOnline(healthRes.ok);

        const alertsRes = await fetch(ALERTS_API_URL, { cache: 'no-store' });
        if (!alertsRes.ok) {
          throw new Error(`Alerts API failed: ${alertsRes.status}`);
        }

        const body = await alertsRes.json();
        if (!mounted) return;
        const incoming = (body.data ?? []) as Alert[];
        setAlerts(incoming);
        setError(null);

        const incomingIds = new Set(incoming.map((a) => a.messageId));
        if (isInitialLoadRef.current) {
          seenMessageIdsRef.current = incomingIds;
          isInitialLoadRef.current = false;
        } else {
          const newAlerts = incoming.filter(
            (a) => !seenMessageIdsRef.current.has(a.messageId)
          );
          if (newAlerts.length > 0) {
            setToasts((prev) => [
              ...prev,
              ...newAlerts.slice(0, 3).map((a) => ({
                id: `${a.messageId}-${Date.now()}`,
                text: `New emergency alert from ${a.senderNickname}`,
              })),
            ]);
          }
          seenMessageIdsRef.current = incomingIds;
        }
      } catch (e) {
        if (!mounted) return;
        setBackendOnline(false);
        setError(e instanceof Error ? e.message : 'Unknown fetch error');
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    tick();
    const timer = setInterval(tick, 2000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  const handleResolveIssue = async (messageId: string) => {
    try {
      setDeletingAlertId(messageId);
      const response = await fetch(
        `${ALERTS_API_URL}/${encodeURIComponent(messageId)}`,
        {
          method: 'DELETE',
        }
      );

      if (!response.ok) {
        throw new Error(`Unable to resolve alert (${response.status})`);
      }

      setAlerts((prev) => prev.filter((alert) => alert.messageId !== messageId));
      seenMessageIdsRef.current.delete(messageId);
      setExpandedAlertId((prev) => (prev === messageId ? null : prev));
      setToasts((prev) => [
        ...prev,
        {
          id: `${messageId}-resolved-${Date.now()}`,
          text: 'Issue marked as resolved and removed from active alerts.',
        },
      ]);
    } catch (resolveError) {
      setToasts((prev) => [
        ...prev,
        {
          id: `${messageId}-resolve-error-${Date.now()}`,
          text:
            resolveError instanceof Error
              ? resolveError.message
              : 'Failed to resolve alert.',
        },
      ]);
    } finally {
      setDeletingAlertId(null);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-emerald-50 via-lime-50 to-white p-4 text-slate-800 md:p-8">
      <section className="mx-auto max-w-7xl">
        <header className="mb-6 rounded-2xl border border-emerald-200 bg-white/90 p-6 shadow-sm shadow-emerald-100">
          <h1 className="text-2xl font-bold tracking-tight text-emerald-800 md:text-3xl">
            Rescue Team Dashboard
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Live emergency feed from BLE mesh bridge. Incoming alerts refresh every
            2 seconds and expand into tactical detail cards with location preview.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">
              Total Alerts: {alerts.length}
            </span>
            <span className="rounded-full bg-lime-100 px-3 py-1 text-xs font-medium text-lime-900">
              Mode: Incident Monitoring
            </span>
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-900">
              Refresh: 2s
            </span>
          </div>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs text-emerald-900">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                backendOnline ? 'bg-emerald-400' : 'bg-red-400'
              }`}
            />
            <span>{headerStatus}</span>
          </div>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </header>

        {isLoading ? (
          <div className="rounded-2xl border border-emerald-200 bg-white p-8 text-center text-slate-600 shadow-sm">
            Loading alerts...
          </div>
        ) : alerts.length === 0 ? (
          <div className="rounded-2xl border border-emerald-200 bg-white p-8 text-center text-slate-600 shadow-sm">
            No alerts received yet.
          </div>
        ) : (
          <div className="space-y-4">
            {alerts.map((alert) => (
              <article
                key={alert.messageId}
                className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm transition hover:shadow-md"
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpandedAlertId((prev) =>
                      prev === alert.messageId ? null : alert.messageId
                    )
                  }
                  className="w-full px-5 py-4 text-left transition hover:bg-emerald-50/40"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="font-semibold text-slate-800">{alert.senderNickname}</p>
                      <p className="text-xs text-slate-500">{alert.senderId}</p>
                    </div>
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800">
                      {new Date(alert.timestamp).toLocaleString(undefined, {
                        hour12: false,
                      })}
                    </div>
                  </div>
                  <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50/40 p-3">
                    <p className="text-sm leading-relaxed text-slate-700">{alert.content}</p>
                  </div>
                  <div className="mt-3 text-xs font-medium text-emerald-700">
                    {expandedAlertId === alert.messageId
                      ? 'Hide details'
                      : 'View details and location'}
                  </div>
                </button>

                {expandedAlertId === alert.messageId && (
                  <div className="grid gap-4 border-t border-emerald-200 bg-emerald-50/40 px-4 py-4 md:grid-cols-2">
                    <div className="space-y-2 rounded-xl border border-emerald-200 bg-white p-4">
                      <h3 className="text-sm font-semibold text-emerald-800">
                        Alert Details
                      </h3>
                      <p className="text-sm">
                        <span className="font-medium text-slate-700">Message:</span>{' '}
                        {alert.content}
                      </p>
                      <p className="text-sm">
                        <span className="font-medium text-slate-700">Timestamp:</span>{' '}
                        {new Date(alert.timestamp).toLocaleString(undefined, {
                          hour12: false,
                        })}
                      </p>
                      <p className="text-sm">
                        <span className="font-medium text-slate-700">Latitude:</span>{' '}
                        {alert.latitude == null ? 'N/A' : alert.latitude.toFixed(6)}
                      </p>
                      <p className="text-sm">
                        <span className="font-medium text-slate-700">Longitude:</span>{' '}
                        {alert.longitude == null ? 'N/A' : alert.longitude.toFixed(6)}
                      </p>
                      <p className="text-sm">
                        <span className="font-medium text-slate-700">Message ID:</span>{' '}
                        {alert.messageId}
                      </p>
                      <button
                        type="button"
                        disabled={deletingAlertId === alert.messageId}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleResolveIssue(alert.messageId);
                        }}
                        className="mt-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
                      >
                        {deletingAlertId === alert.messageId
                          ? 'Resolving...'
                          : 'Issue Resolved'}
                      </button>
                    </div>

                    <div className="rounded-xl border border-emerald-300 bg-white p-4 shadow-inner">
                      <h3 className="mb-3 text-sm font-semibold text-emerald-800">
                        Location Map
                      </h3>
                      {alert.latitude == null || alert.longitude == null ? (
                        <div className="flex h-72 items-center justify-center rounded-lg border border-dashed border-emerald-300 bg-emerald-50 text-sm text-slate-600">
                          Location unavailable for this alert.
                        </div>
                      ) : (
                        <iframe
                          title={`map-${alert.messageId}`}
                          className="h-72 w-full rounded-lg border-2 border-emerald-300"
                          src={`https://www.openstreetmap.org/export/embed.html?bbox=${
                            alert.longitude - 0.01
                          }%2C${alert.latitude - 0.01}%2C${
                            alert.longitude + 0.01
                          }%2C${alert.latitude + 0.01}&layer=mapnik&marker=${
                            alert.latitude
                          }%2C${alert.longitude}`}
                        />
                      )}
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="fixed bottom-4 right-4 z-50 flex w-[320px] flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="rounded-lg border border-emerald-200 bg-white p-3 shadow-lg"
          >
            <p className="text-sm font-medium text-emerald-800">Alert Update</p>
            <p className="text-sm text-slate-700">{toast.text}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
