// Paso 1 · Vehículo (HU-203): tipo con íconos, placa con máscara y datos del vehículo.
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, colors, ErrorMessage, Field } from '../../../shared/ui/form';
import { onboardingController } from '../instance';
import {
  changeVehicleType,
  formatPlateInput,
  maxVehicleYear,
  platePlaceholder,
  VEHICLE_TYPE_OPTIONS,
  type VehicleField,
  type VehicleFormErrors,
  type VehicleFormValues,
} from '../vehicle/vehicle-form';

interface VehicleStepProps {
  initialValues: VehicleFormValues;
  /** Texto del botón: "Continuar" al solicitar, "Enviar corrección" al corregir. */
  submitLabel?: string;
  onDone: () => void;
  onCancel?: () => void;
}

export function VehicleStep({
  initialValues,
  submitLabel = 'Continuar',
  onDone,
  onCancel,
}: VehicleStepProps) {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<VehicleFormErrors>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function set<K extends VehicleField>(field: K, value: VehicleFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function submit() {
    setGeneral(null);
    setNotice(null);
    setLoading(true);
    const result = await onboardingController.apply(values);
    setLoading(false);
    if (result.outcome === 'applied') {
      onDone();
      return;
    }
    if (result.outcome === 'invalid') {
      setErrors(result.errors);
      return;
    }
    const { display } = result;
    if (display.kind === 'field') setErrors({ [display.field]: display.message });
    else if (display.kind === 'alreadyApplied') {
      // El controlador recargó GET /drivers/me: la pantalla muestra lo registrado.
      setNotice(display.message);
      onDone();
    } else setGeneral(display.message);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.step}>Paso 1 de 2 · Tu vehículo</Text>

      <Text style={styles.label}>Tipo de vehículo</Text>
      <View style={styles.types} accessibilityRole="radiogroup">
        {VEHICLE_TYPE_OPTIONS.map((option) => {
          const selected = values.vehicleType === option.type;
          return (
            <Pressable
              key={option.type}
              accessibilityRole="radio"
              accessibilityLabel={option.available ? option.label : `${option.label}, próximamente`}
              accessibilityState={{ selected, disabled: !option.available }}
              disabled={!option.available}
              onPress={() => {
                setValues((current) => changeVehicleType(current, option.type));
                setErrors((current) => ({ ...current, vehicleType: undefined, plate: undefined }));
              }}
              style={[
                styles.type,
                selected && styles.typeSelected,
                !option.available && styles.typeDisabled,
              ]}
            >
              <MaterialCommunityIcons
                name={option.icon}
                size={36}
                color={selected ? colors.background : colors.primary}
              />
              <Text style={[styles.typeLabel, selected && styles.typeLabelSelected]}>
                {option.label}
              </Text>
              <Text style={[styles.typeDescription, selected && styles.typeLabelSelected]}>
                {option.available ? option.description : 'Próximamente'}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <FieldError message={errors.vehicleType} />

      <Text style={styles.label}>Placa</Text>
      <Field
        value={values.plate}
        onChangeText={(text) => set('plate', formatPlateInput(values.vehicleType, text))}
        placeholder={platePlaceholder(values.vehicleType)}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={7}
        accessibilityLabel="Placa"
      />
      <FieldError message={errors.plate} />

      <Text style={styles.label}>Marca</Text>
      <Field
        value={values.brand}
        onChangeText={(text) => set('brand', text)}
        placeholder="Ej.: Bajaj, Chevrolet"
        maxLength={40}
        accessibilityLabel="Marca"
      />
      <FieldError message={errors.brand} />

      <Text style={styles.label}>Línea o modelo</Text>
      <Field
        value={values.model}
        onChangeText={(text) => set('model', text)}
        placeholder="Ej.: RE 4S, Spark GT"
        maxLength={40}
        accessibilityLabel="Línea o modelo"
      />
      <FieldError message={errors.model} />

      <Text style={styles.label}>Color</Text>
      <Field
        value={values.color}
        onChangeText={(text) => set('color', text)}
        placeholder="Ej.: Verde y negro"
        maxLength={30}
        accessibilityLabel="Color"
      />
      <FieldError message={errors.color} />

      <Text style={styles.label}>Año del modelo</Text>
      <Field
        value={values.year}
        onChangeText={(text) => set('year', text.replace(/\D/g, '').slice(0, 4))}
        placeholder={`Ej.: ${maxVehicleYear() - 3}`}
        keyboardType="number-pad"
        maxLength={4}
        accessibilityLabel="Año del modelo"
      />
      <FieldError message={errors.year} />

      <ErrorMessage>{general}</ErrorMessage>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <Button title={submitLabel} onPress={() => void submit()} loading={loading} />
      {onCancel ? <Button title="Cancelar" variant="secondary" onPress={onCancel} /> : null}
    </View>
  );
}

function FieldError({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <Text accessibilityRole="alert" style={styles.fieldError}>
      {message}
    </Text>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8, alignSelf: 'stretch' },
  step: { fontSize: 14, fontWeight: '600', color: colors.muted },
  label: { fontSize: 15, fontWeight: '600', color: colors.text, marginTop: 8 },
  types: { flexDirection: 'row', gap: 8 },
  type: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primary,
    minHeight: 120,
  },
  typeSelected: { backgroundColor: colors.primary },
  typeDisabled: { opacity: 0.45, borderStyle: 'dashed' },
  typeLabel: { fontSize: 15, fontWeight: '700', color: colors.primary, textAlign: 'center' },
  typeLabelSelected: { color: colors.background },
  typeDescription: { fontSize: 12, color: colors.muted, textAlign: 'center' },
  fieldError: { color: colors.error, fontSize: 14 },
  notice: { color: colors.primary, fontSize: 15 },
});
