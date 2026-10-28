import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { DetailShell } from "./DetailShell";
import { Card, Row, Toggle } from "./controls";
import { HubModal } from "../../primitives/HubModal";
import { api } from "../../../api/PondApiClient";
import { ApiError } from "../../../api/types";
import type { Device, HouseholdProfile, HouseholdRole } from "../../../api/types";

// ─── Role display ───────────────────────────────────────────────
const ROLE_LABEL: Record<HouseholdRole, string> = {
  owner: "Owner",
  member: "Member",
  guest: "Guest",
  developer: "Developer",
};
const ROLE_ORDER: HouseholdRole[] = ["owner", "member", "guest", "developer"];

function roleColor(role: HouseholdRole): string {
  switch (role) {
    case "owner": return "#BE185D";
    case "member": return "#2563EB";
    case "guest": return "#D97706";
    case "developer": return "#475569";
  }
}

function guestUntilLabel(iso: string | null): string {
  if (!iso) return "No expiry";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "No expiry";
  const past = d.getTime() <= Date.now();
  return `${past ? "Expired" : "Until"} ${d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

// ─── Flash banner ───────────────────────────────────────────────
function Flash({ flash }: { flash: { text: string; ok: boolean } | null }) {
  if (!flash) return null;
  return (
    <div
      style={{
        padding: "8px 12px",
        borderRadius: 6,
        fontSize: 13,
        background: flash.ok ? "#f0fdf4" : "#fef2f2",
        color: flash.ok ? "#16a34a" : "#dc2626",
        border: `1px solid ${flash.ok ? "#bbf7d0" : "#fecaca"}`,
      }}
      role="status"
      aria-live="polite"
    >
      {flash.text}
    </div>
  );
}

function friendlyError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 409) return "This would leave the household with no owner.";
    if (e.status === 403) return "Only the household's owner can do this.";
    if (e.status === 404) return "That profile or device no longer exists.";
  }
  return `Something went wrong: ${String(e)}`;
}

// ─── Role editor modal ───────────────────────────────────────────
interface RoleModalProps {
  profile: HouseholdProfile;
  onClose: () => void;
  onSaved: (updated: HouseholdProfile) => void;
}

function RoleModal({ profile, onClose, onSaved }: RoleModalProps) {
  const [role, setRole] = useState<HouseholdRole>(profile.role);
  const [guestUntil, setGuestUntil] = useState(
    profile.guest_until ? profile.guest_until.slice(0, 16) : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.setProfileRole(
        profile.id,
        role,
        role === "guest" && guestUntil ? new Date(guestUntil).toISOString() : null,
      );
      onSaved(updated);
      onClose();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <HubModal label={`Change ${profile.display_name}'s role`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "4px 2px" }}>
        <div>
          <h2 className="view-title" style={{ fontSize: 18 }}>
            {profile.avatar_emoji} {profile.display_name}
          </h2>
          <p className="view-sub">Choose what this person may do in the household.</p>
        </div>

        <div className="hseg" role="radiogroup" aria-label="Role">
          {ROLE_ORDER.map((r) => (
            <button
              key={r}
              className="hseg__opt"
              data-active={role === r}
              type="button"
              role="radio"
              aria-checked={role === r}
              onClick={() => setRole(r)}
            >
              {ROLE_LABEL[r]}
            </button>
          ))}
        </div>

        {role === "guest" && (
          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
            <span className="srow__label">Access expires (optional)</span>
            <input
              type="datetime-local"
              value={guestUntil}
              onChange={(e) => setGuestUntil(e.target.value)}
              style={{
                height: 32,
                border: "1px solid #e2e8f0",
                borderRadius: 6,
                padding: "0 8px",
                fontSize: 13,
              }}
            />
          </label>
        )}

        {role === "owner" && profile.role !== "owner" && (
          <p className="view-sub" style={{ color: "#D97706" }}>
            An owner can remove devices, change the model, reset the Pond, and manage everyone
            else's role.
          </p>
        )}

        {error && <Flash flash={{ text: error, ok: false }} />}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="mrow__btn" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="primary-btn" type="button" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </HubModal>
  );
}

// ─── Guest device-access modal ───────────────────────────────────
interface DeviceAccessModalProps {
  profile: HouseholdProfile;
  onClose: () => void;
  onFlash: (text: string, ok: boolean) => void;
}

function DeviceAccessModal({ profile, onClose, onFlash }: DeviceAccessModalProps) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [allowed, setAllowed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [deviceList, access] = await Promise.all([
          api.listDevices(),
          api.listGuestDeviceAccess(profile.id),
        ]);
        if (cancelled) return;
        setDevices(deviceList);
        setAllowed(new Set(access.device_ids));
      } catch (e) {
        if (!cancelled) onFlash(friendlyError(e), false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile.id, onFlash]);

  async function toggle(device: Device, next: boolean) {
    setAllowed((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(device.id);
      else copy.delete(device.id);
      return copy;
    });
    try {
      const result = next
        ? await api.allowGuestDevice(profile.id, device.id)
        : await api.revokeGuestDevice(profile.id, device.id);
      setAllowed(new Set(result.device_ids));
    } catch (e) {
      setAllowed((prev) => {
        // Revert: the call failed, so the allow-list is whatever it was before.
        const copy = new Set(prev);
        if (next) copy.delete(device.id);
        else copy.add(device.id);
        return copy;
      });
      onFlash(friendlyError(e), false);
    }
  }

  return (
    <HubModal label={`${profile.display_name}'s device access`} onClose={onClose} wide>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 2px" }}>
        <div>
          <h2 className="view-title" style={{ fontSize: 18 }}>
            {profile.avatar_emoji} {profile.display_name}'s devices
          </h2>
          <p className="view-sub">Only these devices will answer to {profile.display_name}.</p>
        </div>

        {loading ? (
          <div className="memempty">Loading devices…</div>
        ) : devices.length === 0 ? (
          <div className="memempty">No devices registered yet.</div>
        ) : (
          <div className="devlist">
            {devices.map((d) => (
              <Row
                key={d.id}
                label={d.name}
                sub={d.room ?? d.device_type}
                control={
                  <Toggle
                    on={allowed.has(d.id)}
                    onChange={(next) => toggle(d, next)}
                    label={`Allow ${profile.display_name} to use ${d.name}`}
                  />
                }
              />
            ))}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="mrow__btn" type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </HubModal>
  );
}

// ─── Main screen ──────────────────────────────────────────────
interface HouseholdDetailProps {
  go: (route: string) => void;
}

export function HouseholdDetail({ go }: HouseholdDetailProps) {
  const [profiles, setProfiles] = useState<HouseholdProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(null);
  const [editing, setEditing] = useState<HouseholdProfile | null>(null);
  const [managingDevices, setManagingDevices] = useState<HouseholdProfile | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showFlash = useCallback((text: string, ok = true) => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlash({ text, ok });
    flashTimer.current = setTimeout(() => setFlash(null), 4_000);
  }, []);

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    try {
      const { profiles: list } = await api.listProfiles();
      setProfiles(list);
    } catch (e) {
      showFlash(friendlyError(e), false);
    } finally {
      setLoading(false);
    }
  }, [showFlash]);

  useEffect(() => {
    loadProfiles();
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, [loadProfiles]);

  function handleSaved(updated: HouseholdProfile) {
    setProfiles((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    showFlash(`${updated.display_name} is now ${ROLE_LABEL[updated.role]}.`, true);
  }

  const ownerCount = profiles.filter((p) => p.role === "owner").length;

  return (
    <DetailShell
      title="Household"
      subtitle={
        loading
          ? "Loading members…"
          : `${profiles.length} member${profiles.length !== 1 ? "s" : ""} · ${ownerCount} owner${ownerCount !== 1 ? "s" : ""}`
      }
      accent="#BE185D"
      onBack={() => go("settings")}
      headRight={
        <button
          className="mrow__btn"
          type="button"
          onClick={loadProfiles}
          aria-label="Refresh household"
          style={{ minWidth: 32, display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <RefreshCw size={13} strokeWidth={2} style={{ opacity: loading ? 0.4 : 1 }} />
        </button>
      }
    >
      <Flash flash={flash} />

      {loading && <div className="memempty">Loading members…</div>}

      {!loading && (
        <Card title="Members">
          {profiles.length === 0 ? (
            <div className="memempty">No profiles yet.</div>
          ) : (
            profiles.map((p) => (
              <Row
                key={p.id}
                label={`${p.avatar_emoji} ${p.display_name}`}
                sub={
                  p.role === "guest"
                    ? `Guest · ${guestUntilLabel(p.guest_until)}`
                    : ROLE_LABEL[p.role]
                }
                control={
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: roleColor(p.role),
                        background: `${roleColor(p.role)}1a`,
                        padding: "2px 8px",
                        borderRadius: 999,
                      }}
                    >
                      {ROLE_LABEL[p.role]}
                    </span>
                    {p.role === "guest" && (
                      <button
                        className="mrow__btn"
                        type="button"
                        onClick={() => setManagingDevices(p)}
                      >
                        Devices
                      </button>
                    )}
                    <button className="mrow__btn" type="button" onClick={() => setEditing(p)}>
                      Edit role
                    </button>
                  </span>
                }
              />
            ))
          )}
        </Card>
      )}

      {editing && (
        <RoleModal profile={editing} onClose={() => setEditing(null)} onSaved={handleSaved} />
      )}
      {managingDevices && (
        <DeviceAccessModal
          profile={managingDevices}
          onClose={() => setManagingDevices(null)}
          onFlash={showFlash}
        />
      )}
    </DetailShell>
  );
}
