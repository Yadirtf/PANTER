'use client';

import type { Place } from '@panter/contracts';
import {
  PricingModel,
  PricingModelSchema,
  type FareConfigResponse,
  type FareRuleUpdateBody,
  type VehicleType,
} from '@panter/contracts';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { handleAdminFailure } from '@/features/admin/lib/admin-failure';
import { VEHICLE_LABEL } from '@/shared/lib/format';
import { saveRule } from '../api/fares-client';
import {
  ADMIN_FARES_PATH,
  baseFareLabel,
  formToRuleBody,
  nightRangeText,
  PRICING_MODEL_LABEL,
  ruleBody,
  ruleToForm,
  showsMeteredFields,
  timeToMinutes,
  VEHICLE_ORDER,
  type FieldErrors,
  type RuleForm,
  type RuleFormField,
} from '../lib/fares';
import { diffSnapshots, type FieldChange } from '../lib/history';
import { fareErrorMessage } from '../lib/messages';
import { FarePreview, type PreviewRule } from './fare-preview';
import { DiffList, inputClass, MoneyField, TimeField } from './form-fields';
import { GeofencesEditor } from './geofences-editor';

type Forms = Partial<Record<VehicleType, RuleForm>>;
type Saved = Partial<Record<VehicleType, FareRuleUpdateBody>>;

/** Tarjetas de reglas, vista previa y geocercas de /admin/tarifas (HU-403). */
export function FaresEditor({
  config,
  places = [],
}: {
  config: FareConfigResponse;
  /** Lugares del catálogo (GET /places) para el mapa de geocercas. */
  places?: readonly Place[];
}) {
  const rules = VEHICLE_ORDER.flatMap((type) => {
    const rule = config.rules.find((r) => r.vehicleType === type);
    return rule ? [rule] : [];
  });
  const [saved, setSaved] = useState<Saved>(() =>
    Object.fromEntries(rules.map((rule) => [rule.vehicleType, ruleBody(rule)])),
  );
  const [forms, setForms] = useState<Forms>(() =>
    Object.fromEntries(rules.map((rule) => [rule.vehicleType, ruleToForm(ruleBody(rule))])),
  );

  const previewRules: Partial<Record<VehicleType, PreviewRule>> = {};
  for (const rule of rules) {
    const parsed = formToRuleBody(forms[rule.vehicleType]!);
    previewRules[rule.vehicleType] = parsed.ok
      ? {
          kind: 'ok',
          body: parsed.body,
          dirty: diffSnapshots(saved[rule.vehicleType]!, parsed.body).length > 0,
        }
      : { kind: 'invalid' };
  }

  return (
    <div className="flex flex-col gap-8">
      <FarePreview rules={previewRules} geofences={config.geofences} />

      <section aria-labelledby="reglas" className="flex flex-col gap-4">
        <h2 id="reglas" className="text-xl font-semibold text-stone-900">
          Tarifas por tipo de vehículo
        </h2>
        {rules.length === 0 ? (
          <p className="text-stone-600">No hay tarifas configuradas.</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {rules.map((rule) => (
              <RuleCard
                key={rule.vehicleType}
                vehicleType={rule.vehicleType}
                form={forms[rule.vehicleType]!}
                saved={saved[rule.vehicleType]!}
                onChange={(form) => setForms((all) => ({ ...all, [rule.vehicleType]: form }))}
                onSaved={(body) => setSaved((all) => ({ ...all, [rule.vehicleType]: body }))}
              />
            ))}
          </div>
        )}
      </section>

      <GeofencesEditor geofences={config.geofences} places={places} />
    </div>
  );
}

function RuleCard({
  vehicleType,
  form,
  saved,
  onChange,
  onSaved,
}: {
  vehicleType: VehicleType;
  form: RuleForm;
  saved: FareRuleUpdateBody;
  onChange: (form: RuleForm) => void;
  onSaved: (body: FareRuleUpdateBody) => void;
}) {
  const router = useRouter();
  const [errors, setErrors] = useState<FieldErrors<RuleFormField>>({});
  const [pending, setPending] = useState<{
    body: FareRuleUpdateBody;
    changes: FieldChange[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const id = (field: string) => `${vehicleType}-${field}`;
  const label = VEHICLE_LABEL[vehicleType];

  function set<K extends RuleFormField>(field: K, value: RuleForm[K]) {
    onChange({ ...form, [field]: value });
    setErrors((current) => ({ ...current, [field]: undefined }));
    setPending(null);
    setNotice(null);
  }

  function review() {
    setError(null);
    setNotice(null);
    const parsed = formToRuleBody(form);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    const changes = diffSnapshots(saved, parsed.body);
    if (changes.length === 0) {
      setNotice('No hay cambios para guardar.');
      return;
    }
    setPending({ body: parsed.body, changes });
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    try {
      await saveRule(vehicleType, pending.body);
      onSaved(pending.body);
      setNotice(`Tarifa de ${label} guardada.`);
      setPending(null);
      // Trae del servidor la configuración y el historial nuevos.
      router.refresh();
    } catch (failure) {
      setPending(null);
      handleAdminFailure(failure, ADMIN_FARES_PATH, fareErrorMessage, setError);
    } finally {
      setBusy(false);
    }
  }

  const start = timeToMinutes(form.nightStart);
  const end = timeToMinutes(form.nightEnd);
  const metered = showsMeteredFields(form.pricingModel);

  return (
    <form
      noValidate
      aria-labelledby={id('titulo')}
      onSubmit={(event) => {
        event.preventDefault();
        review();
      }}
      className="flex flex-col gap-4 rounded-xl border border-stone-200 bg-white p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={id('titulo')} className="text-lg font-semibold text-stone-900">
          {label}
        </h3>
        <label className="flex items-center gap-2 text-sm font-medium text-stone-700">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(event) => set('active', event.target.checked)}
            className="h-4 w-4 accent-emerald-700"
          />
          Activa
        </label>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={id('modelo')} className="text-sm font-medium text-stone-700">
          Modelo de cobro
        </label>
        <select
          id={id('modelo')}
          value={form.pricingModel}
          onChange={(event) => {
            const model = PricingModelSchema.safeParse(event.target.value);
            if (model.success) set('pricingModel', model.data);
          }}
          className={inputClass}
        >
          {Object.values(PricingModel).map((model) => (
            <option key={model} value={model}>
              {PRICING_MODEL_LABEL[model]}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <MoneyField
          id={id('baseFare')}
          label={baseFareLabel(form.pricingModel)}
          value={form.baseFare}
          error={errors.baseFare}
          onChange={(value) => set('baseFare', value)}
        />
        <MoneyField
          id={id('minimumFare')}
          label="Tarifa mínima"
          value={form.minimumFare}
          error={errors.minimumFare}
          onChange={(value) => set('minimumFare', value)}
        />
        {metered ? (
          <>
            <MoneyField
              id={id('perKm')}
              label="Valor por kilómetro"
              value={form.perKm}
              error={errors.perKm}
              onChange={(value) => set('perKm', value)}
            />
            <MoneyField
              id={id('perMinute')}
              label="Valor por minuto"
              value={form.perMinute}
              error={errors.perMinute}
              onChange={(value) => set('perMinute', value)}
            />
          </>
        ) : null}
        <MoneyField
          id={id('nightSurcharge')}
          label="Recargo nocturno"
          value={form.nightSurcharge}
          error={errors.nightSurcharge}
          onChange={(value) => set('nightSurcharge', value)}
        />
        <MoneyField
          id={id('roundTo')}
          label="Redondear al múltiplo de"
          value={form.roundTo}
          error={errors.roundTo}
          hint="El total se redondea hacia arriba (p. ej. $ 100)."
          onChange={(value) => set('roundTo', value)}
        />
        <TimeField
          id={id('nightStart')}
          label="Inicio del horario nocturno"
          value={form.nightStart}
          error={errors.nightStart}
          onChange={(value) => set('nightStart', value)}
        />
        <TimeField
          id={id('nightEnd')}
          label="Fin del horario nocturno"
          value={form.nightEnd}
          error={errors.nightEnd}
          onChange={(value) => set('nightEnd', value)}
        />
      </div>
      {start !== null && end !== null ? (
        <p className="text-xs text-stone-500">Horario nocturno: {nightRangeText(start, end)}</p>
      ) : null}
      {!metered ? (
        <p className="text-xs text-stone-500">
          Tarifa plana: el valor por kilómetro y por minuto no se usan.
        </p>
      ) : null}

      <div aria-live="polite">
        {error ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : notice ? (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>
        ) : null}
      </div>

      {pending ? (
        <div
          role="alertdialog"
          aria-labelledby={id('confirmar')}
          className="rounded-lg border border-amber-300 bg-amber-50 p-3"
        >
          <p id={id('confirmar')} className="mb-2 font-medium text-stone-900">
            ¿Guardar estos cambios en la tarifa de {label}? Aplican a los próximos estimados.
          </p>
          <DiffList changes={pending.changes} />
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={confirm}
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
            >
              {busy ? 'Guardando…' : 'Confirmar'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setPending(null)}
              className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-60"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button
          type="submit"
          className="self-start rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
        >
          Guardar cambios
        </button>
      )}
    </form>
  );
}
