import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button, Switch } from "@heroui/react";
import { Users, RefreshCw } from "lucide-react";
import { api } from "../api/PondApiClient";
import { ApiError } from "../api/types";
import type { Device, HouseholdProfile, HouseholdRole } from "../api/types";
import { PageHeader, Section, Row, EmptyState, ErrorBanner, SkeletonList, useDialogFocusTrap } from "../components/shared";

// ─── Role display ───────────────────────────────────────────────
const ROLE_LABEL: Record<HouseholdRole, string> = {
  owner: "Owner",
  member: "Member",
  guest: "Guest",
  developer: "Developer",
};
const ROLE_ORDER: HouseholdRole[] = ["owner", "member", "guest", "developer"];

function roleTone(role: HouseholdRole): { fg: string; bg: string } {
  switch (role) {
    case "owner": return { fg: "var(--color-accent)", bg: "var(--color-accent-soft)" };
    case "guest": return { fg: "var(--color-warning-fg)", bg: "var(--color-warning-soft)" };
    case "developer": return { fg: "var(--color-text-secondary)", bg: "var(--color-border)" };
    case "member": return { fg: "var(--color-success-fg)", bg: "var(--color-success-soft)" };
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

function friendlyError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 409) return "This would leave the household with no owner.";
    if (e.status === 403) return "Only the household's owner can do this.";
    if (e.status === 404) return "That profile or device no longer exists.";
  }
  return `Something went wrong: ${String(e)}`;
}

// ─── Modal shell (matches ModelPickerModal's pattern) ────────────
const modalStyles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(23, 22, 22, 0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  modal: {
    background: "var(--color-bg)",
    borderRadius: "var(--radius-xl)",
    boxShadow: "var(--shadow-canvas)",
    width: "480px",
    maxWidth: "calc(100vw - 32px)",
    maxHeight: "80vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    padding: "var(--space-5)",
    gap: "var(--space-4)",
  },
  title: {
    fontFamily: "var(--font-display)",
    fontWeight: 700,
    fontSize: "var(--text-md)",
    color: "var(--color-text)",
    margin: 0,
  },
  sub: {
    margin: "var(--space-1) 0 0",
    fontSize: "var(--text-sm)",
    color: "var(--color-text-secondary)",
  },
};

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
  const titleId = useId();
  const dialogRef = useDialogFocusTrap<HTMLDivElement>(true, onClose);

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
    <div style={modalStyles.overlay} onClick={onClose}>
      <div
        ref={dialogRef}
        style={modalStyles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 id={titleId} style={modalStyles.title}>
            {profile.avatar_emoji} {profile.display_name}
          </h2>
          <p style={modalStyles.sub}>Choose what this person may do in the household.</p>
        </div>

        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }} role="radiogroup" aria-label="Role">
          {ROLE_ORDER.map((r) => {
            const tone = roleTone(r);
            const active = role === r;
            return (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setRole(r)}
                style={{
                  padding: "6px 14px",
                  borderRadius: "var(--radius-pill, 999px)",
                  fontSize: "var(--text-sm)",
                  fontWeight: 600,
                  cursor: "pointer",
                  border: active ? `1.5px solid ${tone.fg}` : "1px solid var(--color-border)",
                  background: active ? tone.bg : "transparent",
                  color: active ? tone.fg : "var(--color-text-secondary)",
                }}
              >
                {ROLE_LABEL[r]}
              </button>
            );
          })}
        </div>

        {role === "guest" && (
          <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", fontSize: "var(--text-sm)" }}>
            <span style={{ color: "var(--color-text)" }}>Access expires (optional)</span>
            <input
              type="datetime-local"
              value={guestUntil}
              onChange={(e) => setGuestUntil(e.target.value)}
              style={{
                height: 32,
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-md)",
                padding: "0 8px",
                fontSize: "var(--text-sm)",
                background: "var(--color-bg)",
                color: "var(--color-text)",
              }}
            />
          </label>
        )}

        {role === "owner" && profile.role !== "owner" && (
          <p style={{ ...modalStyles.sub, color: "var(--color-warning-fg)" }}>
            An owner can remove devices, change the model, reset the Pond, and manage everyone
            else's role.
          </p>
        )}

        {error && <ErrorBanner error={error} />}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
          <Button size="sm" variant="secondary" onPress={onClose} isDisabled={saving}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onPress={handleSave} isDisabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
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
  const titleId = useId();
  const dialogRef = useDialogFocusTrap<HTMLDivElement>(true, onClose);

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
    <div style={modalStyles.overlay} onClick={onClose}>
      <div
        ref={dialogRef}
        style={modalStyles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 id={titleId} style={modalStyles.title}>
            {profile.avatar_emoji} {profile.display_name}'s devices
          </h2>
          <p style={modalStyles.sub}>Only these devices will answer to {profile.display_name}.</p>
        </div>

        {loading ? (
          <SkeletonList rows={3} />
        ) : devices.length === 0 ? (
          <EmptyState icon={<Users size={20} />}>No devices registered yet.</EmptyState>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", overflowY: "auto" }}>
            {devices.map((d) => (
              <Row key={d.id} label={d.name} hint={d.room ?? d.device_type}>
                <Switch
                  aria-label={`Allow ${profile.display_name} to use ${d.name}`}
                  isSelected={allowed.has(d.id)}
                  onChange={() => toggle(d, !allowed.has(d.id))}
                >
                  <Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control></Switch.Content>
                </Switch>
              </Row>
            ))}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button size="sm" variant="secondary" onPress={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main screen ──────────────────────────────────────────────
export function Household() {
  const [profiles, setProfiles] = useState<HouseholdProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
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
    setLoadError(null);
    try {
      const { profiles: list } = await api.listProfiles();
      setProfiles(list);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

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
    <div className="screen screen--household">
      <PageHeader
        title="Household"
        action={
          <Button size="sm" variant="secondary" onPress={loadProfiles} isDisabled={loading}>
            <RefreshCw size={13} />
          </Button>
        }
      />
      <p className="dev-header__sub">
        {loading
          ? "Loading members…"
          : `${profiles.length} member${profiles.length !== 1 ? "s" : ""} · ${ownerCount} owner${ownerCount !== 1 ? "s" : ""}. Who's here, and what they can do.`}
      </p>

      {flash && (
        <div
          role="status"
          aria-live="polite"
          style={{
            padding: "var(--space-3)",
            borderRadius: "var(--radius-md)",
            fontSize: "var(--text-sm)",
            background: flash.ok ? "var(--color-success-soft)" : "var(--color-destructive-soft)",
            color: flash.ok ? "var(--color-success-fg)" : "var(--color-destructive-fg)",
          }}
        >
          {flash.text}
        </div>
      )}

      {loadError && <ErrorBanner error={loadError} onRetry={loadProfiles} />}

      {loading && <SkeletonList rows={3} />}

      {!loading && !loadError && (
        <Section title="Members">
          {profiles.length === 0 ? (
            <EmptyState icon={<Users size={20} />}>No profiles yet.</EmptyState>
          ) : (
            profiles.map((p) => {
              const tone = roleTone(p.role);
              return (
                <Row
                  key={p.id}
                  label={`${p.avatar_emoji} ${p.display_name}`}
                  hint={p.role === "guest" ? `Guest · ${guestUntilLabel(p.guest_until)}` : undefined}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: tone.fg,
                        background: tone.bg,
                        padding: "2px 8px",
                        borderRadius: 999,
                      }}
                    >
                      {ROLE_LABEL[p.role]}
                    </span>
                    {p.role === "guest" && (
                      <Button size="sm" variant="secondary" onPress={() => setManagingDevices(p)}>
                        Devices
                      </Button>
                    )}
                    <Button size="sm" variant="secondary" onPress={() => setEditing(p)}>
                      Edit role
                    </Button>
                  </div>
                </Row>
              );
            })
          )}
        </Section>
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
    </div>
  );
}
