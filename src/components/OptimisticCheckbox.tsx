import { useEffect, useState } from "react";
import { Checkbox, CheckboxProps } from "@mantine/core";

interface OptimisticCheckboxProps {
  checked: boolean;
  /** Recibe el evento y el nuevo valor deseado. Debe persistir el cambio. */
  onChange: (e: React.ChangeEvent<HTMLInputElement>, newValue: boolean) => Promise<void> | void;
  label?: React.ReactNode;
  size?: CheckboxProps["size"];
  color?: CheckboxProps["color"];
  onClick?: (e: React.MouseEvent<HTMLInputElement>) => void;
  disabled?: boolean;
}

/**
 * Checkbox que refleja el cambio en la UI de inmediato (optimista) antes de que
 * Firestore confirme la escritura. Se sincroniza con `checked` cuando no hay
 * una actualización en curso. Reutilizado por la matriz (admin) y el dashboard.
 */
export default function OptimisticCheckbox({
  checked,
  onChange,
  label,
  size,
  color,
  onClick,
  disabled,
}: OptimisticCheckboxProps) {
  const [localChecked, setLocalChecked] = useState(checked);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    if (!isUpdating) setLocalChecked(checked);
  }, [checked, isUpdating]);

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.currentTarget.checked;
    setLocalChecked(newVal);
    setIsUpdating(true);
    try {
      await onChange(e, !checked);
    } catch {
      // Revertir si falla la persistencia
      setLocalChecked(checked);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <Checkbox
      size={size}
      label={label}
      checked={localChecked}
      onChange={handleChange}
      onClick={onClick}
      color={color}
      disabled={disabled}
    />
  );
}
