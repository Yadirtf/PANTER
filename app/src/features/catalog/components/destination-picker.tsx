// "¿A dónde vas?" (HU-311): pestañas de lugares del catálogo y de barrios y veredas, con
// buscador sin tildes. Las listas salen de la API y, sin señal, de la última copia guardada.
import { MaterialIcons } from '@expo/vector-icons';
import {
  type Area,
  type AreaSummary,
  type Place,
  PLACE_CATEGORY_LABELS,
  type PlaceCategory,
} from '@panter/contracts';
import { iconPngDataUrl, type PlaceIconId } from '@panter/map-style';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { errorMessage } from '../../../shared/api/error-messages';
import { toApiError } from '../../../shared/api/errors';
import { Button, colors, ErrorMessage, Field } from '../../../shared/ui/form';
import type { CatalogResult } from '../catalog-repository';
import { type CatalogListState, useCatalogAreas, useCatalogPlaces } from '../hooks/use-catalog';
import { catalogRepository } from '../instance';
import { placeIcon } from '../place-icon';
import { placeCategories, searchAreas, searchCatalogPlaces } from '../search';

type Tab = 'places' | 'areas';

interface DestinationPickerProps {
  onPlaceSelected: (place: Place) => void;
  onAreaSelected: (area: Area) => void;
}

export function DestinationPicker({ onPlaceSelected, onAreaSelected }: DestinationPickerProps) {
  const [tab, setTab] = useState<Tab>('places');
  return (
    <>
      <View style={styles.tabs} accessibilityRole="tablist">
        <TabButton label="Lugares" selected={tab === 'places'} onPress={() => setTab('places')} />
        <TabButton
          label="Barrios y veredas"
          selected={tab === 'areas'}
          onPress={() => setTab('areas')}
        />
      </View>
      {tab === 'places' ? (
        <PlacesTab onSelected={onPlaceSelected} />
      ) : (
        <AreasTab onSelected={onAreaSelected} />
      )}
    </>
  );
}

function TabButton({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.tab, selected && styles.tabSelected]}
    >
      <Text style={[styles.tabText, selected && styles.tabTextSelected]}>{label}</Text>
    </Pressable>
  );
}

/** Carga, error sin copia guardada o aviso de que se muestra la copia (sin señal). */
function ListStatus<T>({
  state,
  reload,
  what,
}: {
  state: CatalogListState<T>;
  reload: () => void;
  what: string;
}) {
  if (state.status === 'loading') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.muted}>Cargando {what}…</Text>
      </View>
    );
  }
  if (state.status === 'error') {
    return (
      <View style={styles.status}>
        <ErrorMessage>
          {`No pudimos cargar ${what}. ${errorMessage({ code: state.code })} Mientras tanto, toca el mapa para elegir el destino.`}
        </ErrorMessage>
        <Button title="Reintentar" variant="secondary" onPress={reload} />
      </View>
    );
  }
  return <CachedNotice result={state.result} reload={reload} />;
}

function CachedNotice<T>({ result, reload }: { result: CatalogResult<T>; reload: () => void }) {
  if (result.source !== 'cache') return null;
  return (
    <Pressable accessibilityRole="button" onPress={reload} style={styles.cached}>
      <MaterialIcons name="cloud-off" size={16} color={colors.muted} />
      <Text style={styles.small}>
        Sin conexión: es la última lista guardada en el teléfono. Toca para actualizar.
      </Text>
    </Pressable>
  );
}

function PlacesTab({ onSelected }: { onSelected: (place: Place) => void }) {
  const [state, reload] = useCatalogPlaces();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<PlaceCategory | null>(null);
  const places = state.status === 'ready' ? state.result.items : [];
  const categories = useMemo(() => placeCategories(places), [places]);
  const results = useMemo(
    () => searchCatalogPlaces(places, query, category),
    [places, query, category],
  );

  return (
    <>
      <Field
        value={query}
        onChangeText={setQuery}
        placeholder="Buscar lugar (hospital, parque, aeropuerto…)"
        autoCorrect={false}
        accessibilityLabel="Buscar lugar"
      />
      <ListStatus state={state} reload={reload} what="los lugares" />
      {categories.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          keyboardShouldPersistTaps="handled"
        >
          <Chip label="Todos" selected={category === null} onPress={() => setCategory(null)} />
          {categories.map((c) => (
            <Chip
              key={c}
              label={PLACE_CATEGORY_LABELS[c]}
              selected={category === c}
              onPress={() => setCategory(category === c ? null : c)}
            />
          ))}
        </ScrollView>
      ) : null}
      {state.status === 'ready' && results.length === 0 ? (
        <Text style={styles.muted}>
          No hay lugares con ese nombre. Prueba en "Barrios y veredas" o toca el mapa.
        </Text>
      ) : (
        results.map((place) => (
          <Pressable
            key={place.id}
            accessibilityRole="button"
            onPress={() => onSelected(place)}
            style={({ pressed }) => [styles.item, pressed && styles.pressed]}
          >
            <PlaceIconView place={place} />
            <View style={styles.itemText}>
              <Text style={styles.itemName}>{place.name}</Text>
              <Text style={styles.small}>
                {PLACE_CATEGORY_LABELS[place.category]}
                {place.area ? ` · ${place.area.name}` : ''}
              </Text>
              {place.verified ? null : (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>Ubicación aproximada</Text>
                </View>
              )}
            </View>
          </Pressable>
        ))
      )}
    </>
  );
}

const iconUris = new Map<PlaceIconId, string>();
function mapIconUri(id: PlaceIconId): string {
  let uri = iconUris.get(id);
  if (!uri) {
    uri = iconPngDataUrl(id, 3);
    iconUris.set(id, uri);
  }
  return uri;
}

function PlaceIconView({ place }: { place: Place }) {
  const icon = placeIcon(place);
  if (icon.kind === 'map') {
    return <Image source={{ uri: mapIconUri(icon.id) }} style={styles.icon} />;
  }
  return <MaterialIcons name={icon.name} size={24} color={colors.primary} />;
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function AreasTab({ onSelected }: { onSelected: (area: Area) => void }) {
  const [state, reload] = useCatalogAreas();
  const [query, setQuery] = useState('');
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const areas = state.status === 'ready' ? state.result.items : [];
  const groups = useMemo(() => searchAreas(areas, query), [areas, query]);

  const open = (summary: AreaSummary) => {
    setOpening(summary.id);
    setOpenError(null);
    catalogRepository.area(summary.id).then(
      (area) => {
        setOpening(null);
        onSelected(area);
      },
      (error: unknown) => {
        setOpening(null);
        setOpenError(
          `No pudimos cargar el croquis de ${summary.name}. ${errorMessage({ code: toApiError(error).code })}`,
        );
      },
    );
  };

  return (
    <>
      <Field
        value={query}
        onChangeText={setQuery}
        placeholder="Buscar barrio o vereda"
        autoCorrect={false}
        accessibilityLabel="Buscar barrio o vereda"
      />
      <ListStatus state={state} reload={reload} what="los barrios y veredas" />
      {openError ? <ErrorMessage>{openError}</ErrorMessage> : null}
      {state.status === 'ready' && groups.length === 0 ? (
        <Text style={styles.muted}>No hay barrios ni veredas con ese nombre.</Text>
      ) : (
        groups.map((group) => (
          <View key={group.kind} style={styles.group}>
            <Text style={styles.groupTitle}>{group.title}</Text>
            {group.items.map((area) => (
              <Pressable
                key={area.id}
                accessibilityRole="button"
                disabled={opening !== null}
                onPress={() => open(area)}
                style={({ pressed }) => [styles.item, pressed && styles.pressed]}
              >
                <MaterialIcons
                  name={area.kind === 'BARRIO' ? 'location-city' : 'forest'}
                  size={22}
                  color={colors.primary}
                />
                <Text style={[styles.itemName, styles.itemText]}>{area.name}</Text>
                {opening === area.id ? <ActivityIndicator color={colors.primary} /> : null}
              </Pressable>
            ))}
          </View>
        ))
      )}
    </>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 12,
    overflow: 'hidden',
  },
  tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  tabSelected: { backgroundColor: colors.primary },
  tabText: { fontSize: 15, fontWeight: '600', color: colors.primary },
  tabTextSelected: { color: colors.background },
  muted: { fontSize: 15, color: colors.muted },
  small: { fontSize: 13, color: colors.muted, flexShrink: 1 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 },
  status: { gap: 8 },
  cached: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chips: { gap: 8, paddingVertical: 2 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 12,
    minHeight: 34,
    justifyContent: 'center',
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 14, color: colors.text },
  chipTextSelected: { color: colors.background, fontWeight: '600' },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pressed: { opacity: 0.7 },
  icon: { width: 26, height: 26 },
  itemText: { flex: 1, gap: 2 },
  itemName: { fontSize: 16, fontWeight: '600', color: colors.text },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#fef3c7',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  badgeText: { fontSize: 12, fontWeight: '600', color: '#92400e' },
  group: { gap: 2 },
  groupTitle: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase' },
});
