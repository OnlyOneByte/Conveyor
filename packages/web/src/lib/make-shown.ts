let shown = false;

export const makeShown = () => shown;

export function showMake(): () => void {
  shown = true;
  return () => {
    shown = false;
  };
}
