// Panel inferior del pasajero (HU-404): destino, vehículo y estimado con desglose.
import { MaterialIcons } from '@expo/vector-icons';
import { VehicleType } from '@panter/contracts';
import { type Dispatch, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Button, colors, ErrorMessage, Field } from '../../../shared/ui/form';
import { mapBreakdown, VEHICLE_LABELS } from '../estimate/breakdown';
import { formatCop, formatDistance, formatDuration } from '../estimate/format';
import {
  type PlannerAction,
  type PlannerState,
  plannerRouteNotices,
  plannerStep,
  QUOTABLE_VEHICLES,
  type QuoteState,
} from '../estimate/planner';
import type { QuoteValidity } from '../estimate/quote-validity';
import type { RouteNotices } from '../estimate/route-quality';
import { searchPlaces } from '../places/frequent-places';

interface TripPanelProps {
  state: PlannerState;
  dispatch: Dispatch<PlannerAction>;
  validity: QuoteValidity | null;
}

export function TripPanel({ state, dispatch, validity }: TripPanelProps) {
  const { height } = useWindowDimensions();
  const step = plannerStep(state);
  return (
    <View style={styles.card}>
      <ScrollView
        style={{ maxHeight: height * 0.5 }}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {step === 'choose-destination' ? (
          <ChooseDestination state={state} dispatch={dispatch} />
        ) : step === 'confirm-destination' ? (
          <>
            <Text style={styles.title}>Destino en el mapa</Text>
            <Text style={styles.muted}>
              ¿Es aquí? Puedes tocar otro punto del mapa para moverlo.
            </Text>
            <Button
              title="Confirmar destino"
              onPress={() => dispatch({ type: 'candidateConfirmed' })}
            />
            <Button
              title="Cancelar"
              variant="secondary"
              onPress={() => dispatch({ type: 'candidateCancelled' })}
            />
          </>
        ) : (
          <Quote state={state} dispatch={dispatch} validity={validity} />
        )}
      </ScrollView>
    </View>
  );
}

function ChooseDestination({ state, dispatch }: Omit<TripPanelProps, 'validity'>) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchPlaces(query), [query]);
  return (
    <>
      <Text style={styles.title}>¿A dónde vas?</Text>
      <Text style={styles.muted}>
        Toca el mapa para poner el destino o elige un lugar frecuente.
      </Text>
      <OriginHint state={state} />
      <Field
        value={query}
        onChangeText={setQuery}
        placeholder="Buscar lugar frecuente"
        autoCorrect={false}
        accessibilityLabel="Buscar lugar frecuente"
      />
      {results.length === 0 ? (
        <Text style={styles.muted}>
          No hay lugares frecuentes con ese nombre. Toca el mapa para elegir el destino.
        </Text>
      ) : (
        results.map((place) => (
          <Pressable
            key={place.id}
            accessibilityRole="button"
            onPress={() => dispatch({ type: 'placeSelected', place })}
            style={({ pressed }) => [styles.place, pressed && styles.pressed]}
          >
            <MaterialIcons
              name={
                place.kind === 'airport'
                  ? 'flight'
                  : place.kind === 'park'
                    ? 'park'
                    : place.kind === 'town'
                      ? 'location-city'
                      : 'terrain'
              }
              size={22}
              color={colors.primary}
            />
            <View style={styles.placeText}>
              <Text style={styles.placeName}>{place.name}</Text>
              <Text style={styles.small}>
                {place.description}
                {place.approximate ? ' · ubicación aproximada' : ''}
              </Text>
            </View>
          </Pressable>
        ))
      )}
    </>
  );
}

function OriginHint({ state }: { state: PlannerState }) {
  if (state.origin.source === 'gps') return null;
  return (
    <Text style={styles.small}>
      {state.origin.source === 'manual'
        ? 'Origen: el punto donde dejaste el pin verde.'
        : 'Sin tu ubicación, el origen es el parque principal. Arrastra el pin verde a tu punto de recogida.'}
    </Text>
  );
}

function Quote({ state, dispatch, validity }: TripPanelProps) {
  const { destination, quote, vehicle } = state;
  return (
    <>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Text style={styles.title} numberOfLines={1}>
            {destination?.name ? `Hacia ${destination.name}` : 'Hacia el punto del mapa'}
          </Text>
          <Text style={styles.small}>Arrastra el pin verde para cambiar el punto de recogida.</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => dispatch({ type: 'destinationCleared' })}
          hitSlop={8}
        >
          <Text style={styles.link}>Cambiar destino</Text>
        </Pressable>
      </View>

      <View style={styles.segment} accessibilityRole="radiogroup">
        {QUOTABLE_VEHICLES.map((type) => {
          const selected = type === vehicle;
          return (
            <Pressable
              key={type}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => dispatch({ type: 'vehicleSelected', vehicle: type })}
              style={[styles.option, selected && styles.optionSelected]}
            >
              <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                {VEHICLE_LABELS[type]}
              </Text>
            </Pressable>
          );
        })}
        <View
          accessibilityRole="radio"
          accessibilityState={{ disabled: true }}
          style={[styles.option, styles.optionDisabled]}
        >
          <Text style={styles.optionTextDisabled}>{VEHICLE_LABELS[VehicleType.JEEP_4X4]}</Text>
          <Text style={styles.soon}>Próximamente</Text>
        </View>
      </View>

      <RouteNoticesView notices={plannerRouteNotices(state)} dispatch={dispatch} />

      <QuoteBody quote={quote} dispatch={dispatch} validity={validity} />

      <View style={styles.order}>
        <Button title="Pedir viaje" disabled onPress={() => undefined} />
        <Text style={styles.soonCenter}>Disponible pronto</Text>
      </View>
    </>
  );
}

/** Avisos de HU-307: pin lejos de la vía (mover o dejar así) y ruta inusual. */
function RouteNoticesView({
  notices,
  dispatch,
}: {
  notices: RouteNotices;
  dispatch: Dispatch<PlannerAction>;
}) {
  if (notices.snaps.length === 0 && !notices.unusual) return null;
  return (
    <>
      {notices.snaps.map((notice) => (
        <View key={notice.end} style={styles.warning} accessibilityRole="alert">
          <View style={styles.warningHeader}>
            <MaterialIcons name="wrong-location" size={20} color={WARNING_TEXT} />
            <Text style={styles.warningText}>{notice.message}</Text>
          </View>
          <Text style={styles.small}>
            La ruta y el precio se calcularon desde el punto naranja de la vía.
          </Text>
          <View style={styles.warningActions}>
            {notice.roadPoint ? (
              <View style={styles.flex}>
                <Button
                  title="Mover el pin a la vía"
                  onPress={() => dispatch({ type: 'snapPinMoved', end: notice.end })}
                />
              </View>
            ) : null}
            <View style={styles.flex}>
              <Button
                title="Está bien así"
                variant="secondary"
                onPress={() => dispatch({ type: 'snapAccepted', end: notice.end })}
              />
            </View>
          </View>
        </View>
      ))}
      {notices.unusual ? (
        <View style={styles.warning} accessibilityRole="alert">
          <View style={styles.warningHeader}>
            <MaterialIcons name="alt-route" size={20} color={WARNING_TEXT} />
            <Text style={styles.warningText}>{notices.unusual.message}</Text>
          </View>
          <Text style={styles.small}>La línea punteada es la distancia en línea recta.</Text>
        </View>
      ) : null}
    </>
  );
}

function QuoteBody({
  quote,
  dispatch,
  validity,
}: {
  quote: QuoteState;
  dispatch: Dispatch<PlannerAction>;
  validity: QuoteValidity | null;
}) {
  switch (quote.status) {
    case 'none':
      return null;
    case 'loading':
      return (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.muted}>
            {quote.renewal ? 'El precio venció. Actualizándolo…' : 'Calculando ruta y precio…'}
          </Text>
        </View>
      );
    case 'error':
      return (
        <View style={styles.error}>
          <Text style={styles.errorTitle}>{quote.error.title}</Text>
          <ErrorMessage>{quote.error.message}</ErrorMessage>
          {quote.error.action === 'retry' ? (
            <Button title="Reintentar" onPress={() => dispatch({ type: 'retry' })} />
          ) : quote.error.action === 'change-destination' ? (
            <Button
              title="Elegir otro destino"
              variant="secondary"
              onPress={() => dispatch({ type: 'destinationCleared' })}
            />
          ) : null}
        </View>
      );
    case 'ready':
    case 'expired': {
      const view = mapBreakdown(quote.estimate);
      const expired = quote.status === 'expired';
      const { route } = quote.estimate;
      return (
        <View style={styles.quote}>
          {quote.status === 'ready' && quote.updatedFrom !== null ? (
            <View style={styles.updated} accessibilityRole="alert">
              <MaterialIcons name="update" size={18} color={colors.primary} />
              <Text style={styles.updatedText}>
                Precio actualizado
                {quote.updatedFrom !== quote.estimate.total
                  ? ` (antes ${formatCop(quote.updatedFrom)})`
                  : ''}
              </Text>
            </View>
          ) : null}
          <View style={styles.row}>
            <Text style={[styles.total, expired && styles.stale]}>{view.formattedTotal}</Text>
            <Text style={styles.muted}>
              {formatDistance(route.distanceMeters)} · {formatDuration(route.durationSeconds)}
            </Text>
          </View>
          {quote.estimate.isNight ? <Text style={styles.small}>Tarifa nocturna</Text> : null}
          {view.rows.map((row, index) => (
            <View key={`${row.code}-${index}`} style={styles.breakdownRow}>
              <Text style={[styles.breakdownLabel, row.kind === 'surcharge' && styles.surcharge]}>
                {row.label}
              </Text>
              <Text style={styles.breakdownAmount}>{row.formatted}</Text>
            </View>
          ))}
          <View style={[styles.breakdownRow, styles.totalRow]}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalLabel}>{view.formattedTotal}</Text>
          </View>
          {expired ? (
            <>
              <Text style={styles.small}>
                El precio venció. Actualízalo antes de pedir el viaje.
              </Text>
              <Button title="Actualizar precio" onPress={() => dispatch({ type: 'retry' })} />
            </>
          ) : validity ? (
            <Text style={styles.small}>{validity.label}</Text>
          ) : null}
        </View>
      );
    }
  }
}

const WARNING_TEXT = '#92400e';

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.background,
    borderRadius: 12,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  content: { padding: 14, gap: 10 },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  muted: { fontSize: 15, color: colors.muted },
  small: { fontSize: 13, color: colors.muted },
  link: { fontSize: 15, fontWeight: '600', color: colors.primary },
  pressed: { opacity: 0.7 },
  place: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  placeText: { flex: 1 },
  placeName: { fontSize: 16, fontWeight: '600', color: colors.text },
  segment: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 12,
    overflow: 'hidden',
  },
  option: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  optionSelected: { backgroundColor: colors.primary },
  optionDisabled: { backgroundColor: '#f1f4f3' },
  optionText: { fontSize: 16, fontWeight: '600', color: colors.primary },
  optionTextSelected: { color: colors.background },
  optionTextDisabled: { fontSize: 15, fontWeight: '600', color: colors.muted },
  soon: { fontSize: 11, color: colors.muted },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 },
  error: { gap: 8 },
  errorTitle: { fontSize: 16, fontWeight: '700', color: colors.error },
  quote: { gap: 6 },
  warning: {
    gap: 6,
    backgroundColor: '#fef3c7',
    borderRadius: 8,
    padding: 10,
  },
  warningHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  warningText: { flex: 1, fontSize: 15, fontWeight: '600', color: WARNING_TEXT },
  warningActions: { flexDirection: 'row', gap: 8 },
  updated: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#e8f3ec',
    borderRadius: 8,
    padding: 8,
  },
  updatedText: { fontSize: 14, fontWeight: '600', color: colors.primary },
  total: { fontSize: 30, fontWeight: '800', color: colors.text },
  stale: { color: colors.muted, textDecorationLine: 'line-through' },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  breakdownLabel: { flex: 1, fontSize: 14, color: colors.text },
  surcharge: { color: '#92400e' },
  breakdownAmount: { fontSize: 14, color: colors.text, fontVariant: ['tabular-nums'] },
  totalRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 6,
  },
  totalLabel: { fontSize: 16, fontWeight: '700', color: colors.text },
  order: { gap: 4, marginTop: 4 },
  soonCenter: { fontSize: 13, color: colors.muted, textAlign: 'center' },
});
