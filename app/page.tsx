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
  hopCount: number;
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

  return (
    <main className="min-h-screen bg-white p-4 text-slate-800 md:p-8">
      <section className="mx-auto max-w-7xl">
        <header className="mb-6 rounded-2xl border border-red-100 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-bold tracking-tight text-red-700 md:text-3xl">
            Firefighter Emergency Dashboard
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Live emergency feed from BLE mesh bridge. Incoming alerts refresh every
            2 seconds and expand into tactical detail cards with location preview.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-red-700">
              Total Alerts: {alerts.length}
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
              Mode: Incident Monitoring
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
              Refresh: 2s
            </span>
          </div>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-red-200 px-3 py-1 text-xs">
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
          <div className="rounded-2xl border border-red-100 bg-white p-8 text-center text-slate-600 shadow-sm">
            Loading alerts...
          </div>
        ) : alerts.length === 0 ? (
          <div className="rounded-2xl border border-red-100 bg-white p-8 text-center text-slate-600 shadow-sm">
            No alerts received yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-red-100 bg-white shadow-sm">
            <div className="grid grid-cols-12 border-b border-red-100 bg-red-50/60 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-red-700">
              <div className="col-span-3">Sender</div>
              <div className="col-span-5">Message</div>
              <div className="col-span-2">Time</div>
              <div className="col-span-2 text-right">Hop Count</div>
            </div>

            {alerts.map((alert) => (
              <article key={alert.messageId} className="border-b border-red-50 last:border-b-0">
                <button
                  type="button"
                  onClick={() =>
                    setExpandedAlertId((prev) =>
                      prev === alert.messageId ? null : alert.messageId
                    )
                  }
                  className="grid w-full grid-cols-12 items-center gap-2 px-4 py-4 text-left transition hover:bg-red-50/40"
                >
                  <div className="col-span-3">
                    <p className="font-semibold text-slate-800">{alert.senderNickname}</p>
                    <p className="text-xs text-slate-500">{alert.senderId}</p>
                  </div>
                  <div className="col-span-5">
                    <p className="truncate text-sm text-slate-700">{alert.content}</p>
                  </div>
                  <div className="col-span-2 text-xs text-slate-600">
                    {new Date(alert.timestamp).toLocaleString(undefined, {
                      hour12: false,
                    })}
                  </div>
                  <div className="col-span-2 text-right">
                    <span className="rounded-md bg-red-100 px-2 py-1 text-xs font-medium text-red-700">
                      {alert.hopCount}
                    </span>
                  </div>
                </button>

                {expandedAlertId === alert.messageId && (
                  <div className="grid gap-4 border-t border-red-100 bg-slate-50/60 px-4 py-4 md:grid-cols-2">
                    <div className="space-y-2 rounded-xl border border-red-100 bg-white p-4">
                      <h3 className="text-sm font-semibold text-red-700">Alert Details</h3>
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
                    </div>

                    <div className="rounded-xl border border-red-100 bg-white p-4">
                      <h3 className="mb-3 text-sm font-semibold text-red-700">Location Map</h3>
                      {alert.latitude == null || alert.longitude == null ? (
                        <div className="flex h-72 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
                          Location unavailable for this alert.
                        </div>
                      ) : (
                        <iframe
                          title={`map-${alert.messageId}`}
                          className="h-72 w-full rounded-lg border border-red-100"
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
            className="rounded-lg border border-red-200 bg-white p-3 shadow-lg"
          >
            <p className="text-sm font-medium text-red-700">New Alert</p>
            <p className="text-sm text-slate-700">{toast.text}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
