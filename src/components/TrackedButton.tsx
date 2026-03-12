import { Button, ButtonProps } from '@mantine/core';
import { trackButtonClick } from '../utils/analytics';

interface TrackedButtonProps extends ButtonProps {
  trackingName: string;
  trackingLocation?: string;
}

/**
 * Botón que trackea automáticamente los clicks en Analytics
 * Usa todos los props de Mantine Button + tracking
 */
export function TrackedButton({
  trackingName,
  trackingLocation = 'unknown',
  onClick,
  children,
  ...buttonProps
}: TrackedButtonProps) {
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    // Trackear el click
    trackButtonClick(trackingName, trackingLocation);
    
    // Ejecutar el onClick original si existe
    if (onClick) {
      onClick(event);
    }
  };

  return (
    <Button onClick={handleClick} {...buttonProps}>
      {children}
    </Button>
  );
}
