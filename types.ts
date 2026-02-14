
export interface BalanceSummary {
  mevcutBakiye: number;
  alacakBakiyesi: number;
  demirbasKasasi: number;
  toplam: number;
}

export interface BuildingInfo {
  name: string;
  address: string;
  role: string;
  taxNo?: string;
  managerName?: string;
  duesAmount: number;
  managerUnitId?: string;
  isManagerExempt: boolean;
  isAutoDuesEnabled: boolean;
}

export interface OwnerHistory {
  id: string;
  name: string;
  startDate: string;
  endDate?: string;
  phone: string;
  isCurrent: boolean;
}

export interface TenantHistory {
  id: string;
  name: string;
  startDate: string;
  endDate?: string;
  phone: string;
  isCurrent: boolean;
}

export interface Unit {
  id: string;
  no: string;
  ownerName: string;
  tenantName?: string;
  phone: string; // Malik Telefonu
  tenantPhone?: string; // Kiracı Telefonu
  credit: number;
  debt: number;
  type?: string; // e.g., "3+1"
  m2?: number; // e.g., 100
  huzurHakki?: string; // e.g., "YOK" or "VAR"
  status?: string; // "Malik" or "Kiracı"
  ownerHistory?: OwnerHistory[];
  tenantHistory?: TenantHistory[];
}

export interface Transaction {
  id: string;
  type: 'GELİR' | 'GİDER' | 'BORÇLANDIRMA' | 'TRANSFER';
  amount: number;
  date: string;
  description: string;
  unitId?: string;
  periodMonth?: number; // 0-11
  periodYear?: number;
}

export interface BoardMember {
  id: string;
  name: string;
  role: string;
  phone: string;
}

export interface FileEntry {
  id: string;
  name: string;
  category: 'Fatura' | 'Sözleşme' | 'Tutanak' | 'Karar' | 'Diğer';
  date: string;
  size: string;
  extension: string;
  uri?: string; // Dosya yolu (mobil cihazlarda)
  fileName?: string; // Gerçek dosya adı (Documents klasöründe)
  data?: string; // Dosya içeriği (base64/dataURL)
}

export interface ManagementMeta {
  name: string;
  ownerUid: string;
  createdAt: number;
}

export type ActiveTab = 'home' | 'menu' | 'sessions' | 'settings' | 'files';
