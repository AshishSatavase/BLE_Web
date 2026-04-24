'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

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

const formatTimestampDirect = (timestamp: string) => {
  if (!timestamp) return { date: '-', time: '-' };

  const [datePart, timeRaw = ''] = timestamp.split('T');
  const timePart = timeRaw.replace('Z', '').split('.')[0];

  return {
    date: datePart || '-',
    time: timePart || '-',
  };
};

const getAlertSignature = (alert: Alert) => {
  const parsed = new Date(alert.timestamp);
  const normalizedTimestamp = Number.isNaN(parsed.getTime())
    ? alert.timestamp.trim()
    : parsed.toISOString();

  return [
    alert.senderId.trim().toLowerCase(),
    alert.senderNickname.trim().toLowerCase(),
    alert.content.trim().toLowerCase(),
    normalizedTimestamp,
  ].join('|');
};

export default function DashboardPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [backendOnline, setBackendOnline] = useState(false);
  const [expandedAlertIds, setExpandedAlertIds] = useState<Set<string>>(new Set());
  const [deletingAlertId, setDeletingAlertId] = useState<string | null>(null);
  const [previousSearch, setPreviousSearch] = useState('');
  const [selectedPreviousAlert, setSelectedPreviousAlert] = useState<Alert | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seenAlertSignaturesRef = useRef<Set<string>>(new Set());
  const isInitialLoadRef = useRef(true);

  const headerStatus = useMemo(
    () => (backendOnline ? 'Backend Online' : 'Backend Offline'),
    [backendOnline]
  );

  const uniqueAlerts = useMemo(() => {
    const uniqueBySignature = new Map<string, Alert>();
    for (const alert of alerts) {
      const signature = getAlertSignature(alert);
      if (!uniqueBySignature.has(signature)) {
        uniqueBySignature.set(signature, alert);
      }
    }

    return Array.from(uniqueBySignature.values()).sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [alerts]);

  const { recentAlerts, previousAlerts } = useMemo(() => {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recent: Alert[] = [];
    const previous: Alert[] = [];

    for (const alert of uniqueAlerts) {
      const timestampMs = new Date(alert.timestamp).getTime();
      if (Number.isNaN(timestampMs) || timestampMs < oneHourAgo) {
        previous.push(alert);
      } else {
        recent.push(alert);
      }
    }

    return { recentAlerts: recent, previousAlerts: previous };
  }, [uniqueAlerts]);

  const filteredPreviousAlerts = useMemo(() => {
    const query = previousSearch.trim().toLowerCase();
    if (!query) {
      return previousAlerts;
    }

    return previousAlerts.filter((alert) =>
      [alert.senderNickname, alert.senderId, alert.content, alert.messageId]
        .join(' ')
        .toLowerCase()
        .includes(query)
    );
  }, [previousAlerts, previousSearch]);

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

        const incomingSignatures = new Set(incoming.map(getAlertSignature));
        if (isInitialLoadRef.current) {
          seenAlertSignaturesRef.current = incomingSignatures;
          isInitialLoadRef.current = false;
        } else {
          const newAlerts = incoming.filter(
            (a) => !seenAlertSignaturesRef.current.has(getAlertSignature(a))
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
          seenAlertSignaturesRef.current = incomingSignatures;
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
      setExpandedAlertIds((prev) => {
        const next = new Set(prev);
        next.delete(messageId);
        return next;
      });
      setSelectedPreviousAlert((prev) =>
        prev?.messageId === messageId ? null : prev
      );
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

  const toggleAlertExpansion = (messageId: string) => {
    setExpandedAlertIds((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
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
              Total Alerts: {uniqueAlerts.length}
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
          <div className="grid gap-6 lg:grid-cols-3">
            <section className="space-y-4 lg:col-span-2">
              <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-white px-4 py-3">
                <h2 className="text-lg font-semibold text-emerald-800">Recent Alerts</h2>
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                  {recentAlerts.length}
                </span>
              </div>

              {recentAlerts.length === 0 ? (
                <div className="rounded-2xl border border-emerald-200 bg-white p-6 text-sm text-slate-600">
                  No recent alerts in the last hour.
                </div>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm">
                  <table className="w-full text-left">
                    <thead className="bg-emerald-100/70 text-xs uppercase tracking-wide text-emerald-900">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Sender</th>
                        <th className="px-4 py-3 font-semibold">Message</th>
                        <th className="px-4 py-3 font-semibold">Time</th>
                        <th className="px-4 py-3 font-semibold text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentAlerts.map((alert) => {
                        const isExpanded = expandedAlertIds.has(alert.messageId);

                        return (
                          <Fragment key={alert.messageId}>
                            <tr className="border-t border-emerald-100 align-top">
                              <td className="px-4 py-4">
                                <p className="font-semibold text-slate-800">{alert.senderNickname}</p>
                                <p className="text-xs text-slate-500">{alert.senderId}</p>
                              </td>
                              <td className="px-4 py-4">
                                <p className="max-w-md truncate text-sm text-slate-700">
                                  {alert.content}
                                </p>
                              </td>
                              <td className="px-4 py-4 text-xs text-slate-700">
                                {(() => {
                                  const ts = formatTimestampDirect(alert.timestamp);
                                  return `${ts.date} ${ts.time}`;
                                })()}
                              </td>
                              <td className="px-4 py-4">
                                <div className="flex flex-wrap justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() => toggleAlertExpansion(alert.messageId)}
                                    className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50"
                                  >
                                    {isExpanded ? 'Hide Details' : 'Show Details'}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={deletingAlertId === alert.messageId}
                                    onClick={() => handleResolveIssue(alert.messageId)}
                                    className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
                                  >
                                    {deletingAlertId === alert.messageId
                                      ? 'Resolving...'
                                      : 'Issue Resolved'}
                                  </button>
                                </div>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr>
                                <td colSpan={4} className="bg-emerald-50/40 px-4 py-4">
                                  <div className="grid gap-4 border-t border-emerald-200 pt-4 md:grid-cols-2">
                                    <div className="space-y-3 rounded-xl border border-emerald-200 bg-white p-4">
                                      <h3 className="text-sm font-semibold uppercase tracking-wide text-emerald-800">
                                        Message Details
                                      </h3>
                                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                                        <p className="text-sm leading-relaxed text-slate-700">
                                          {alert.content}
                                        </p>
                                      </div>
                                      <div className="grid gap-2 text-sm">
                                        <div className="rounded-md bg-emerald-50 px-3 py-2">
                                          <span className="mr-1">🕒</span>
                                          <span className="font-medium text-slate-700">
                                            Date:
                                          </span>{' '}
                                          {(() => {
                                            const ts = formatTimestampDirect(alert.timestamp);
                                            return ts.date;
                                          })()}
                                        </div>
                                        <div className="rounded-md bg-emerald-50 px-3 py-2">
                                          <span className="mr-1">🕒</span>
                                          <span className="font-medium text-slate-700">
                                            Time:
                                          </span>{' '}
                                          {(() => {
                                            const ts = formatTimestampDirect(alert.timestamp);
                                            return ts.time;
                                          })()}
                                        </div>
                                      </div>
                                      <table className="w-full overflow-hidden rounded-lg border border-emerald-200 text-sm">
                                        <thead className="bg-emerald-100 text-emerald-900">
                                          <tr>
                                            <th className="px-3 py-2 text-left font-semibold">Field</th>
                                            <th className="px-3 py-2 text-left font-semibold">Value</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          <tr className="border-t border-emerald-100">
                                            <td className="px-3 py-2 font-medium text-slate-700">
                                              Latitude
                                            </td>
                                            <td className="px-3 py-2 text-slate-700">
                                              {alert.latitude == null
                                                ? 'N/A'
                                                : alert.latitude.toFixed(6)}
                                            </td>
                                          </tr>
                                          <tr className="border-t border-emerald-100">
                                            <td className="px-3 py-2 font-medium text-slate-700">
                                              Longitude
                                            </td>
                                            <td className="px-3 py-2 text-slate-700">
                                              {alert.longitude == null
                                                ? 'N/A'
                                                : alert.longitude.toFixed(6)}
                                            </td>
                                          </tr>
                                        </tbody>
                                      </table>
                                    </div>

                                    <div className="rounded-xl border border-emerald-300 bg-white p-4 shadow-inner">
                                      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-emerald-800">
                                        <span className="mr-1">📍</span>Location Map
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
                                            alert.longitude - 0.003
                                          }%2C${alert.latitude - 0.003}%2C${
                                            alert.longitude + 0.003
                                          }%2C${alert.latitude + 0.003}&layer=mapnik&marker=${
                                            alert.latitude
                                          }%2C${alert.longitude}`}
                                        />
                                      )}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm lg:col-span-1">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-semibold text-emerald-800">Previous Alerts</h2>
                <span className="rounded-full bg-lime-100 px-2.5 py-1 text-xs font-semibold text-lime-900">
                  {filteredPreviousAlerts.length}
                </span>
              </div>

              <input
                type="text"
                value={previousSearch}
                onChange={(event) => setPreviousSearch(event.target.value)}
                placeholder="Search sender, id, or message"
                className="mb-3 w-full rounded-lg border border-emerald-300 px-3 py-2 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
              />

              <div className="overflow-hidden rounded-lg border border-emerald-200">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-emerald-100 text-emerald-900">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Sender</th>
                      <th className="px-3 py-2 font-semibold">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPreviousAlerts.length === 0 ? (
                      <tr>
                        <td colSpan={2} className="px-3 py-6 text-center text-slate-500">
                          No matching previous alerts.
                        </td>
                      </tr>
                    ) : (
                      filteredPreviousAlerts.map((alert) => (
                        <tr
                          key={alert.messageId}
                          onClick={() => setSelectedPreviousAlert(alert)}
                          className="cursor-pointer border-t border-emerald-100 transition hover:bg-emerald-50"
                        >
                          <td className="px-3 py-2">
                            <p className="font-medium text-slate-800">{alert.senderNickname}</p>
                            <p className="text-xs text-slate-500">{alert.senderId}</p>
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-700">
                            {(() => {
                              const ts = formatTimestampDirect(alert.timestamp);
                              return `${ts.date} ${ts.time}`;
                            })()}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
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

      {selectedPreviousAlert && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-emerald-200 bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-emerald-800">Previous Alert Details</h3>
              <button
                type="button"
                onClick={() => setSelectedPreviousAlert(null)}
                className="rounded-md border border-emerald-300 px-3 py-1.5 text-sm font-medium text-emerald-800 hover:bg-emerald-50"
              >
                Close
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-sm">
                <span className="font-medium text-slate-700">Sender:</span>{' '}
                {selectedPreviousAlert.senderNickname}
              </div>
              <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-sm">
                <span className="font-medium text-slate-700">Sender ID:</span>{' '}
                {selectedPreviousAlert.senderId}
              </div>
              <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-sm">
                <span className="font-medium text-slate-700">Date:</span>{' '}
                {(() => {
                  const ts = formatTimestampDirect(selectedPreviousAlert.timestamp);
                  return ts.date;
                })()}
              </div>
              <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-sm">
                <span className="font-medium text-slate-700">Time:</span>{' '}
                {(() => {
                  const ts = formatTimestampDirect(selectedPreviousAlert.timestamp);
                  return ts.time;
                })()}
              </div>
              <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-sm md:col-span-2">
                <span className="mr-1">🕒</span>
                <span className="font-medium text-slate-700">Status:</span> Previous Alert
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="mb-1 text-sm font-semibold text-slate-700">Main Message</p>
              <p className="text-sm leading-relaxed text-slate-700">
                {selectedPreviousAlert.content}
              </p>
            </div>

            <table className="mt-4 w-full overflow-hidden rounded-lg border border-emerald-200 text-sm">
              <thead className="bg-emerald-100 text-emerald-900">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Field</th>
                  <th className="px-3 py-2 text-left font-semibold">Value</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-emerald-100">
                  <td className="px-3 py-2 font-medium text-slate-700">Latitude</td>
                  <td className="px-3 py-2 text-slate-700">
                    {selectedPreviousAlert.latitude == null
                      ? 'N/A'
                      : selectedPreviousAlert.latitude.toFixed(6)}
                  </td>
                </tr>
                <tr className="border-t border-emerald-100">
                  <td className="px-3 py-2 font-medium text-slate-700">Longitude</td>
                  <td className="px-3 py-2 text-slate-700">
                    {selectedPreviousAlert.longitude == null
                      ? 'N/A'
                      : selectedPreviousAlert.longitude.toFixed(6)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}
