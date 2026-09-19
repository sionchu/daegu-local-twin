declare module "suncalc" {
  export type SunPosition = {
    azimuth: number;
    altitude: number;
  };

  export function getPosition(date: Date, latitude: number, longitude: number): SunPosition;

  const SunCalc: {
    getPosition: typeof getPosition;
  };

  export default SunCalc;
}
