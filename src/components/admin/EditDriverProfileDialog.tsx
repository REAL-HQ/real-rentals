import { useState } from "react";
import { toast } from "sonner";
import { PhoneInput } from "@/components/ui/phone-input";
import { AppSelect } from "@/components/ui/app-select";
import { useServerFn } from "@tanstack/react-start";
import { updateDriverProfileBasics } from "@/lib/driver-profile-edit.functions";
import { normalizeDriverProfileEdit, normalizeProfileState, splitDriverName, type ProfileField } from "@/lib/driver-profile-edit";
import { US_STATES } from "@/lib/us-states";
import { Field, FormGrid, inputCls, ModalBody, ModalButton, ModalFooter, ModalHeader, ModalShell } from "./modal";

type DriverBits = {
  id: string;
  full_name?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  state?: string | null;
};

export function EditDriverProfileDialog({
  driver,
  onClose,
  onSaved,
}: {
  driver: DriverBits;
  onClose: () => void;
  onSaved: (patch: {
    full_name: string;
    email: string;
    phone: string;
    city: string | null;
    state: string | null;
    sms_consent: boolean | null;
  }) => void;
}) {
  const save = useServerFn(updateDriverProfileBasics);
  const name = splitDriverName(driver.full_name);
  const initialState = normalizeProfileState(driver.state) ?? "";
  const [firstName, setFirstName] = useState(name.firstName);
  const [lastName, setLastName] = useState(name.lastName);
  const [phone, setPhone] = useState(driver.phone ?? "");
  const [email, setEmail] = useState(driver.email ?? "");
  const [city, setCity] = useState(driver.city ?? "");
  const [state, setState] = useState(initialState);
  const [field, setField] = useState<ProfileField | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    if (busy) return;
    const parsed = normalizeDriverProfileEdit({ firstName, lastName, phone, email, city, state });
    if (!parsed.ok) {
      setField(parsed.field);
      setError(parsed.error);
      return;
    }
    setBusy(true);
    setError(null);
    setField(null);
    try {
      const result = await save({
        data: {
          applicationId: driver.id,
          firstName,
          lastName,
          phone,
          email,
          city,
          state,
        },
      });
      onSaved({
        full_name: result.profile.full_name,
        email: result.profile.email,
        phone: result.profile.phone,
        city: result.profile.city,
        state: result.profile.state,
        sms_consent: result.profile.sms_consent,
      });
      if (result.unchanged) toast.success("No Changes To Save");
      else if (result.syncWarning) toast.warning(result.syncWarning);
      else toast.success("Profile Updated");
      onClose();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not save this profile.";
      setError(message);
      setField("form");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell onClose={() => { if (!busy) onClose(); }} size="md" label="Edit Profile">
      <ModalHeader
        title="Edit Profile"
        subtitle="No Message Is Sent"
        onClose={() => { if (!busy) onClose(); }}
      />
      <ModalBody className="space-y-4">
        <FormGrid cols={2}>
          <Field label="First Name" required error={field === "firstName" ? error : null}>
            <input
              className={inputCls}
              aria-label="First Name"
              data-testid="profile-first-name"
              autoComplete="given-name"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
            />
          </Field>
          <Field label="Last Name" error={field === "lastName" ? error : null}>
            <input
              className={inputCls}
              aria-label="Last Name"
              data-testid="profile-last-name"
              autoComplete="family-name"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
            />
          </Field>
          <Field label="Phone" required error={field === "phone" ? error : null}>
            <PhoneInput
              className={inputCls}
              aria-label="Phone"
              data-testid="profile-phone"
              mode="us"
              value={phone}
              onValueChange={setPhone}
            />
          </Field>
          <Field label="Email" required error={field === "email" ? error : null}>
            <input
              className={inputCls}
              aria-label="Email"
              data-testid="profile-email"
              type="email"
              autoComplete="email"
              autoCapitalize="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field label="City" error={field === "city" ? error : null}>
            <input
              className={inputCls}
              aria-label="City"
              data-testid="profile-city"
              autoComplete="address-level2"
              value={city}
              onChange={(event) => setCity(event.target.value)}
            />
          </Field>
          <Field label="State" error={field === "state" ? error : null}>
            <AppSelect
              aria-label="State"
              data-testid="profile-state"
              className={inputCls}
              value={state}
              onChange={(event) => setState(event.target.value)}
            >
              <option value="">Select State</option>
              {US_STATES.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.code} — {item.name}
                </option>
              ))}
            </AppSelect>
          </Field>
        </FormGrid>
        {field === "form" && error ? <p className="text-sm text-brand">{error}</p> : null}
      </ModalBody>
      <ModalFooter>
        <ModalButton variant="secondary" disabled={busy} onClick={onClose}>
          Cancel
        </ModalButton>
        <ModalButton variant="primary" data-testid="profile-save" disabled={busy} onClick={() => { void onSubmit(); }}>
          {busy ? "Saving…" : "Save Profile"}
        </ModalButton>
      </ModalFooter>
    </ModalShell>
  );
}
