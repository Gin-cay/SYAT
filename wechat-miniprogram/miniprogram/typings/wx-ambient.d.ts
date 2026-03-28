/** 无 node_modules 时的最小声明，避免 TS 报错；微信开发者工具亦可结合官方 typings 使用 */

declare namespace WechatMiniprogram {
  interface MapMarker {
    id: number;
    latitude: number;
    longitude: number;
    width?: number;
    height?: number;
    callout?: { content: string; display?: string };
  }
  interface MapPolyline {
    points: Array<{ latitude: number; longitude: number }>;
    color?: string;
    width?: number;
  }
  interface SwitchChange {
    detail: { value: unknown };
  }
  interface RadioGroupChange {
    detail: { value: string };
  }
  interface TextareaInput {
    detail: { value: string };
  }
  interface Input {
    detail: { value: string };
  }
  interface TouchEvent {
    currentTarget: { dataset: Record<string, string | number | undefined> };
  }
  interface PickerChange {
    detail: { value: string };
  }
  interface SliderChange {
    detail: { value: number };
  }
}

declare interface IAppOption {
  globalData: {
    env: string;
    pythonBackendBaseUrl: string;
    patrolUploadUrl: string;
    patrolSingleSubmitUrl?: string;
    patrolListUrl?: string;
    reportUploadUrl: string;
    /** 火情历史上报列表 GET，响应 JSON 含 records 或 data */
    fireReportListUrl?: string;
    patrolVoiceUploadUrl: string;
    lang: string;
    emergencyUploadUrl: string;
    t?: (key: string) => string;
  };
}
