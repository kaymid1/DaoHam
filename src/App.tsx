import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// ============================================================================
// 1. CẤU HÌNH CÂN BẰNG GAME (Dễ dàng chỉnh sửa toàn bộ thông số tại đây)
// ============================================================================
const GAME_CONFIG = {
  STORAGE_KEY: 'ham_sau_save_v1',
  CAMPAIGN_DAYS: 14,
  DAILY_TRIBUTES: [
    55, 95, 145, 200, 265, 340, 425,
    520, 625, 740, 870, 1010, 1170, 1350,
  ] as const,
  START_SHOVELS: 3,
  START_BAG_SLOTS: 5,
  START_SHOWCASE_SLOTS: 3,
  MAX_SHOWCASE_SLOTS: 8,
  START_COINS: 15,

  // Công thức nguy cơ sập hầm: base + perMeter * depth (giới hạn 3% - 60%)
  RISK_BASE: 8,
  RISK_PER_METER: 4.5,
  RISK_MIN: 3,
  RISK_MAX: 60,
  HEARTBEAT_RISK_THRESHOLD: 28,

  // Khiên, chuỗi đào vô hạn & chờ lộ kết quả
  SHIELD_THRESHOLD: 3,
  FRENZY_STREAK_REQUIRED: 10,
  FRENZY_DURATION_MS: 2000,
  FRENZY_DIG_COOLDOWN_MS: 230,
  REVEAL_DELAY_MIN_MS: 180,
  REVEAL_DELAY_MAX_MS: 700,

  // Kinh tế, phần dư cống & phiên chợ thương nhân mỗi 3 ngày
  PASSIVE_INCOME_RATE: 0.05,
  MARKET_FLUCTUATION: 0.2,
  SURPLUS_TO_COINS_RATE: 1,
  MERCHANT_INTERVAL_DAYS: 3,
  MAX_SOCKETS_PER_EQUIP: 4,
  SOCKET_UPGRADE_COSTS: [0, 0, 55, 95] as const,
  MAP_START_DEPTH: 3,
  SHOP_PRICES: {
    extraShovel: 30,
    bagSlot: 46,
    showcaseSlot: 40,
    map: 26,
    removeGem: 20,
    timeRewind: 72,
    dynamite: 42,
    luckyCompass: 34,
    superLamp: 28,
  },
} as const;

// ============================================================================
// 2. KIỂU DỮ LIỆU & DANH MỤC VẬT PHẨM / TẦNG ĐỊA CHẤT
// ============================================================================
type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
type ItemCategory = 'ore' | 'gem' | 'relic';
type GemKind = 'ruby' | 'sapphire' | 'emerald' | 'diamond' | 'amethyst' | 'topaz';
type RelicSetId = 'pharaoh' | 'pirate' | 'empire';
type EquipSlotId = 'shovel' | 'helmet' | 'prop';
type GamePhase = 'INTRO' | 'MINING' | 'WORKSHOP' | 'TRIBUTE' | 'VICTORY' | 'DEFEAT';
type WorkshopTab = 'warehouse' | 'showcase' | 'inlay' | 'market';
type StratumId = 'earth' | 'cavern' | 'ruins' | 'volcano';

interface ItemTemplate {
  id: string;
  name: string;
  category: ItemCategory;
  baseValue: number;
  color: string;
  gemKind?: GemKind;
  relicSet?: RelicSetId;
  description: string;
}

interface GameItem {
  uid: string;
  templateId: string;
  name: string;
  category: ItemCategory;
  rarity: Rarity;
  value: number;
  color: string;
  gemKind?: GemKind;
  relicSet?: RelicSetId;
  keepForTribute?: boolean;
  notForTribute?: boolean;
  earnedDay?: number;
  nonTributeReason?: 'old_day' | 'purchased' | 'unmounted_or_showcase';
}

interface EquipmentState {
  shovel: (GameItem | null)[];
  helmet: (GameItem | null)[];
  prop: (GameItem | null)[];
}

interface MarketModifiers {
  ore: number;
  gem: number;
  relic: number;
}

interface MerchantOffer {
  uid: string;
  templateId: string;
  rarity: Rarity;
  price: number;
  sold: boolean;
}

interface DailyShopOffer {
  uid: string;
  kind:
    | 'shovel_1'
    | 'shovel_2'
    | 'shield_start'
    | 'random_gem'
    | 'map_discount'
    | 'time_rewind_discount'
    | 'dynamite_discount'
    | 'lucky_compass_discount'
    | 'super_lamp_discount';
  title: string;
  subtitle: string;
  price: number;
  sold: boolean;
}

interface RewindSnapshot {
  depth: number;
  shieldPoints: number;
  safeDigStreak: number;
  bag: GameItem[];
  lastFoundItem: GameItem | null;
  collapsedAtDepth: number;
  lostCount: number;
}

interface VisitorOrder {
  targetTemplateId: string;
  targetName: string;
  targetCategory: ItemCategory;
  rewardCoins: number;
  fulfilled: boolean;
  visitorName: string;
}

interface GameState {
  day: number;
  endlessMode?: boolean;
  phase: GamePhase;
  workshopTab: WorkshopTab;
  coins: number;

  // Tài nguyên & nâng cấp vĩnh viễn / cho ván kế
  baseShovels: number;
  extraShovelsTomorrow: number;
  shovelsUsed: number;
  baseBagSlots: number;
  showcaseSlots: number;
  hasMapForToday: boolean;
  hasMapForTomorrow: boolean;
  bonusStartShieldToday?: number;
  bonusStartShieldTomorrow?: number;
  luckyDayToday?: boolean;
  luckyDayTomorrow?: boolean;
  superLampToday?: boolean;
  superLampTomorrow?: boolean;
  timeRewinds?: number;
  dynamiteCount?: number;

  // Trạng thái lượt đào hiện tại & chuỗi đào an toàn
  inShaft: boolean;
  depth: number;
  shieldPoints: number;
  safeDigStreak: number;
  bag: GameItem[];
  lastOutcomeText: string;
  lastFoundItem: GameItem | null;

  // Kho, Tủ trưng bày, Bộ sưu tập lưu trữ vĩnh viễn, Trang bị khảm, Thương nhân
  warehouse: GameItem[];
  showcase: GameItem[];
  collectionRecord: string[];
  equipment: EquipmentState;
  market: MarketModifiers;
  merchantOffers: MerchantOffer[];
  dailyShopOffers: DailyShopOffer[];
  visitor: VisitorOrder | null;

  // Thống kê hành trình
  stats: {
    totalDug: number;
    maxDepth: number;
    collapses: number;
    shieldSaves: number;
    rewindsUsed?: number;
    totalCoinsEarned: number;
  };
}

interface StratumConfig {
  id: StratumId;
  name: string;
  minDepth: number;
  maxDepth: number;
  bgTop: string;
  bgBottom: string;
  rockFill: string;
  veinColor: string;
  droneFreq: number;
  droneCutoff: number;
  weights: { ore: number; gem: number; relic: number };
}

const RARITY_INFO: Record<
  Rarity,
  { label: string; mult: number; border: string; glow: string; text: string; hex: string }
> = {
  common: {
    label: 'Thường',
    mult: 1.0,
    border: 'border-stone-500/45',
    glow: '',
    text: 'text-stone-300',
    hex: '#a8a29e',
  },
  rare: {
    label: 'Hiếm',
    mult: 1.45,
    border: 'border-sky-400/55',
    glow: 'shadow-[0_0_16px_rgba(56,189,248,0.2)]',
    text: 'text-sky-300',
    hex: '#38bdf8',
  },
  epic: {
    label: 'Sử thi',
    mult: 2.1,
    border: 'border-purple-400/65',
    glow: 'shadow-[0_0_18px_rgba(192,132,252,0.28)]',
    text: 'text-purple-300',
    hex: '#c084fc',
  },
  legendary: {
    label: 'Huyền thoại',
    mult: 3.2,
    border: 'border-amber-400/80',
    glow: 'shadow-[0_0_24px_rgba(251,191,36,0.38)]',
    text: 'text-amber-300',
    hex: '#fbbf24',
  },
};

const STRATA: StratumConfig[] = [
  {
    id: 'earth',
    name: 'Tầng Đất Đá',
    minDepth: 0,
    maxDepth: 5,
    bgTop: '#291c14',
    bgBottom: '#19110c',
    rockFill: '#463225',
    veinColor: '#c88d55',
    droneFreq: 58,
    droneCutoff: 190,
    weights: { ore: 68, gem: 23, relic: 9 },
  },
  {
    id: 'cavern',
    name: 'Tầng Hang Động',
    minDepth: 6,
    maxDepth: 10,
    bgTop: '#162226',
    bgBottom: '#0d1518',
    rockFill: '#24373e',
    veinColor: '#38bdf8',
    droneFreq: 70,
    droneCutoff: 280,
    weights: { ore: 30, gem: 54, relic: 16 },
  },
  {
    id: 'ruins',
    name: 'Tầng Di Tích Cổ',
    minDepth: 11,
    maxDepth: 15,
    bgTop: '#261d11',
    bgBottom: '#150f08',
    rockFill: '#4d3920',
    veinColor: '#eab308',
    droneFreq: 84,
    droneCutoff: 370,
    weights: { ore: 16, gem: 38, relic: 46 },
  },
  {
    id: 'volcano',
    name: 'Lòng Núi Lửa',
    minDepth: 16,
    maxDepth: 999,
    bgTop: '#2e100b',
    bgBottom: '#140604',
    rockFill: '#5c1f16',
    veinColor: '#fb7185',
    droneFreq: 98,
    droneCutoff: 520,
    weights: { ore: 10, gem: 55, relic: 35 },
  },
];

const ITEM_TEMPLATES: ItemTemplate[] = [
  // Quặng
  {
    id: 'ore_copper',
    name: 'Quặng Đồng',
    category: 'ore',
    baseValue: 11,
    color: '#d97736',
    description: 'Quặng thô ấm ánh đỏ, dễ đào ở tầng nông.',
  },
  {
    id: 'ore_silver',
    name: 'Quặng Bạc',
    category: 'ore',
    baseValue: 19,
    color: '#cbd5e1',
    description: 'Mạch bạc sáng lạnh ẩn trong lớp đá xám.',
  },
  {
    id: 'ore_gold',
    name: 'Quặng Vàng',
    category: 'ore',
    baseValue: 30,
    color: '#f5b82e',
    description: 'Vàng ròng nặng tay, được Chủ Mỏ ưa chuộng.',
  },

  // Ngọc
  {
    id: 'gem_ruby',
    name: 'Hồng Ngọc',
    category: 'gem',
    gemKind: 'ruby',
    baseValue: 34,
    color: '#f43f5e',
    description: 'Khảm trang bị: tăng giá trị đồ đào được.',
  },
  {
    id: 'gem_sapphire',
    name: 'Lam Ngọc',
    category: 'gem',
    gemKind: 'sapphire',
    baseValue: 36,
    color: '#3b82f6',
    description: 'Khảm trang bị: giảm nguy cơ sập hầm.',
  },
  {
    id: 'gem_emerald',
    name: 'Lục Bảo',
    category: 'gem',
    gemKind: 'emerald',
    baseValue: 38,
    color: '#10b981',
    description: 'Khảm trang bị: tích điểm khiên nhanh hơn.',
  },
  {
    id: 'gem_amethyst',
    name: 'Thạch Anh Tím',
    category: 'gem',
    gemKind: 'amethyst',
    baseValue: 42,
    color: '#a855f7',
    description: 'Khảm trang bị: nhìn trước loại đồ tầng kế tiếp.',
  },
  {
    id: 'gem_diamond',
    name: 'Kim Cương',
    category: 'gem',
    gemKind: 'diamond',
    baseValue: 64,
    color: '#67e8f9',
    description: 'Khảm trang bị: có xác suất nhân đôi món đào được.',
  },
  {
    id: 'gem_topaz',
    name: 'Hoàng Ngọc',
    category: 'gem',
    gemKind: 'topaz',
    baseValue: 35,
    color: '#f59e0b',
    description: 'Khảm trang bị: mở rộng mạnh sức chứa túi đồ khi đào.',
  },

  // Bộ Pharaoh (4 mảnh)
  {
    id: 'relic_pharaoh_mask',
    name: 'Mặt Nạ Vàng',
    category: 'relic',
    relicSet: 'pharaoh',
    baseValue: 54,
    color: '#fbbf24',
    description: 'Di vật Bộ Pharaoh · Khảm trưng bày để kích hoạt bộ.',
  },
  {
    id: 'relic_pharaoh_scarab',
    name: 'Bọ Hung Ngọc',
    category: 'relic',
    relicSet: 'pharaoh',
    baseValue: 48,
    color: '#2dd4bf',
    description: 'Di vật Bộ Pharaoh · Bùa hộ mệnh cổ đại.',
  },
  {
    id: 'relic_pharaoh_ankh',
    name: 'Trượng Ankh',
    category: 'relic',
    relicSet: 'pharaoh',
    baseValue: 50,
    color: '#f59e0b',
    description: 'Di vật Bộ Pharaoh · Biểu tượng sinh mệnh vĩnh cửu.',
  },
  {
    id: 'relic_pharaoh_canopic',
    name: 'Bình Canopic',
    category: 'relic',
    relicSet: 'pharaoh',
    baseValue: 46,
    color: '#d97706',
    description: 'Di vật Bộ Pharaoh · Bình gốm niêm phong cổ.',
  },

  // Bộ Hải tặc (4 mảnh)
  {
    id: 'relic_pirate_compass',
    name: 'La Bàn Cổ',
    category: 'relic',
    relicSet: 'pirate',
    baseValue: 48,
    color: '#eab308',
    description: 'Di vật Bộ Hải tặc · Chỉ hướng mạch kho báu.',
  },
  {
    id: 'relic_pirate_anchor',
    name: 'Mỏ Neo Đồng',
    category: 'relic',
    relicSet: 'pirate',
    baseValue: 45,
    color: '#cd7f32',
    description: 'Di vật Bộ Hải tặc · Vững chãi trước sóng gió.',
  },
  {
    id: 'relic_pirate_skull',
    name: 'Hộp Sọ Pha Lê',
    category: 'relic',
    relicSet: 'pirate',
    baseValue: 58,
    color: '#7dd3fc',
    description: 'Di vật Bộ Hải tặc · Chiến lợi phẩm huyền bí.',
  },
  {
    id: 'relic_pirate_key',
    name: 'Chìa Khóa Kho Báu',
    category: 'relic',
    relicSet: 'pirate',
    baseValue: 50,
    color: '#facc15',
    description: 'Di vật Bộ Hải tặc · Mở khóa rương cổ bị chôn vùi.',
  },

  // Bộ Đế chế cổ (4 mảnh)
  {
    id: 'relic_empire_crown',
    name: 'Vương Miện Sắt',
    category: 'relic',
    relicSet: 'empire',
    baseValue: 56,
    color: '#e2e8f0',
    description: 'Di vật Bộ Đế chế cổ · Quyền uy của triều đại xưa.',
  },
  {
    id: 'relic_empire_seal',
    name: 'Ấn Triện Hoàng Gia',
    category: 'relic',
    relicSet: 'empire',
    baseValue: 50,
    color: '#f87171',
    description: 'Di vật Bộ Đế chế cổ · Dấu ấn sắc lệnh hoàng triều.',
  },
  {
    id: 'relic_empire_shield',
    name: 'Khiên Đồng Cổ',
    category: 'relic',
    relicSet: 'empire',
    baseValue: 48,
    color: '#fb923c',
    description: 'Di vật Bộ Đế chế cổ · Tấm khiên khắc phù điêu.',
  },
  {
    id: 'relic_empire_tablet',
    name: 'Chiếu Chỉ Đá',
    category: 'relic',
    relicSet: 'empire',
    baseValue: 46,
    color: '#94a3b8',
    description: 'Di vật Bộ Đế chế cổ · Bia khắc sử thi cổ đại.',
  },
];

const RELIC_SETS: Record<
  RelicSetId,
  { name: string; bonusLabel: string; pieces: string[] }
> = {
  pharaoh: {
    name: 'Bộ Pharaoh',
    bonusLabel: '-8% nguy cơ sập hầm vĩnh viễn',
    pieces: [
      'relic_pharaoh_mask',
      'relic_pharaoh_scarab',
      'relic_pharaoh_ankh',
      'relic_pharaoh_canopic',
    ],
  },
  pirate: {
    name: 'Bộ Hải Tặc',
    bonusLabel: '+1 Xẻng mỗi ngày',
    pieces: [
      'relic_pirate_compass',
      'relic_pirate_anchor',
      'relic_pirate_skull',
      'relic_pirate_key',
    ],
  },
  empire: {
    name: 'Bộ Đế Chế Cổ',
    bonusLabel: '+2 Ô túi đào vĩnh viễn',
    pieces: [
      'relic_empire_crown',
      'relic_empire_seal',
      'relic_empire_shield',
      'relic_empire_tablet',
    ],
  },
};

const EQUIPMENT_META: Record<EquipSlotId, { name: string; subtitle: string }> = {
  shovel: { name: 'Xẻng Thép Cổ', subtitle: 'Đào sâu & khai khoáng' },
  helmet: { name: 'Mũ Đèn Dầu', subtitle: 'Soi mạch ngọc & cảnh báo' },
  prop: { name: 'Cột Chống Gỗ Sắt', subtitle: 'Gia cố vòm hầm & khiên' },
};

// ============================================================================
// 3. CÁC HÀM THUẦN LOGIC GAME (Pure Functions - dễ cân bằng & kiểm thử)
// ============================================================================

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function makeUid(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getStratum(depth: number): StratumConfig {
  return (
    STRATA.find((s) => depth >= s.minDepth && depth <= s.maxDepth) ?? STRATA[STRATA.length - 1]
  );
}

function getTributeForDay(day: number): number {
  if (day <= GAME_CONFIG.DAILY_TRIBUTES.length) {
    return GAME_CONFIG.DAILY_TRIBUTES[Math.max(0, day - 1)];
  }
  const lastBase = GAME_CONFIG.DAILY_TRIBUTES[GAME_CONFIG.DAILY_TRIBUTES.length - 1];
  const extraDays = day - GAME_CONFIG.DAILY_TRIBUTES.length;
  return Math.round(lastBase * Math.pow(1.16, extraDays));
}

function isMerchantDay(day: number): boolean {
  return day > 0 && day % GAME_CONFIG.MERCHANT_INTERVAL_DAYS === 0;
}

function getNextMerchantDay(day: number): number {
  const rem = day % GAME_CONFIG.MERCHANT_INTERVAL_DAYS;
  return rem === 0 ? day : day + (GAME_CONFIG.MERCHANT_INTERVAL_DAYS - rem);
}

interface ComputedBonuses {
  valueBonusPct: number;
  riskReductionPct: number;
  extraShieldChance: number;
  doubleDropChance: number;
  foresightEnabled: boolean;
  inlayExtraBagSlots: number;
  completedSets: RelicSetId[];
  setExtraShovels: number;
  setExtraBagSlots: number;
}

function getGemPowerMultiplier(rarity: Rarity): number {
  switch (rarity) {
    case 'common':
      return 1;
    case 'rare':
      return 1.5;
    case 'epic':
      return 2.1;
    case 'legendary':
      return 3.0;
  }
}

function getGemBagBonus(gemKind: GemKind | undefined, rarity: Rarity): number {
  const baseByRarity: Record<Rarity, number> = {
    common: 1,
    rare: 2,
    epic: 3,
    legendary: 4,
  };
  const topazExtra: Record<Rarity, number> = {
    common: 2,
    rare: 3,
    epic: 4,
    legendary: 6,
  };
  return baseByRarity[rarity] + (gemKind === 'topaz' ? topazExtra[rarity] : 0);
}

function computeBonuses(
  equipment: EquipmentState,
  showcase: GameItem[],
  collectionRecord: string[] = []
): ComputedBonuses {
  let valueBonusPct = 0;
  let riskReductionPct = 0;
  let extraShieldChance = 0;
  let doubleDropChance = 0;
  let foresightEnabled = false;
  let inlayExtraBagSlots = 0;

  const allSockets = [...equipment.shovel, ...equipment.helmet, ...equipment.prop];
  for (const gem of allSockets) {
    if (!gem || !gem.gemKind) continue;
    const p = getGemPowerMultiplier(gem.rarity);
    // Mỗi viên ngọc khảm vào trang bị đều gia cố dây đeo túi đồ
    inlayExtraBagSlots += getGemBagBonus(gem.gemKind, gem.rarity);

    switch (gem.gemKind) {
      case 'ruby':
        valueBonusPct += 0.1 * p;
        break;
      case 'sapphire':
        riskReductionPct += 4.0 * p;
        break;
      case 'emerald':
        extraShieldChance += 0.28 * p;
        break;
      case 'diamond':
        doubleDropChance += 0.14 * p;
        break;
      case 'amethyst':
        foresightEnabled = true;
        valueBonusPct += 0.06 * p;
        break;
      case 'topaz':
        valueBonusPct += 0.06 * p;
        break;
    }
  }

  // Kiểm tra các bộ di vật đã đủ 4 mảnh (trên Tủ kính hoặc đã lưu Bộ sưu tập)
  const showcaseTemplateIds = new Set(showcase.map((item) => item.templateId));
  const recordedIds = new Set(collectionRecord);
  const completedSets: RelicSetId[] = [];
  (Object.keys(RELIC_SETS) as RelicSetId[]).forEach((setId) => {
    const allPresent = RELIC_SETS[setId].pieces.every(
      (tid) => showcaseTemplateIds.has(tid) || recordedIds.has(tid)
    );
    if (allPresent) completedSets.push(setId);
  });

  if (completedSets.includes('pharaoh')) {
    riskReductionPct += 8;
  }
  const setExtraShovels = completedSets.includes('pirate') ? 1 : 0;
  const setExtraBagSlots = completedSets.includes('empire') ? 2 : 0;

  return {
    valueBonusPct,
    riskReductionPct,
    extraShieldChance: clamp(extraShieldChance, 0, 0.9),
    doubleDropChance: clamp(doubleDropChance, 0, 0.75),
    foresightEnabled,
    inlayExtraBagSlots,
    completedSets,
    setExtraShovels,
    setExtraBagSlots,
  };
}

function computeCollapseRisk(depth: number, bonuses: ComputedBonuses): number {
  const raw =
    GAME_CONFIG.RISK_BASE + GAME_CONFIG.RISK_PER_METER * depth - bonuses.riskReductionPct;
  return clamp(Math.round(raw * 10) / 10, GAME_CONFIG.RISK_MIN, GAME_CONFIG.RISK_MAX);
}

function computeRevealDelayMs(risk: number): number {
  const ratio = clamp(
    (risk - GAME_CONFIG.RISK_MIN) / (GAME_CONFIG.RISK_MAX - GAME_CONFIG.RISK_MIN),
    0,
    1
  );
  return Math.round(
    GAME_CONFIG.REVEAL_DELAY_MIN_MS +
      ratio * (GAME_CONFIG.REVEAL_DELAY_MAX_MS - GAME_CONFIG.REVEAL_DELAY_MIN_MS)
  );
}

function rollRarity(depth: number, luckBoost = false): Rarity {
  const roll = Math.random() * 100;
  // Tầng nông vẫn có tỷ lệ nhỏ đồ hiếm/huyền thoại; xuống sâu hoặc dùng La Bàn May Mắn tỷ lệ tăng cao
  const deepExtra = depth >= 22 ? 6 : 0;
  const legendaryChance =
    (depth >= 16 ? 17 : depth >= 11 ? 9 : depth >= 6 ? 3.5 : 1.2) +
    deepExtra * 0.5 +
    (luckBoost ? 5 : 0);
  const epicChance =
    (depth >= 16 ? 32 : depth >= 11 ? 23 : depth >= 6 ? 13 : 5) +
    deepExtra * 0.5 +
    (luckBoost ? 9 : 0);
  const rareChance =
    (depth >= 16 ? 34 : depth >= 11 ? 35 : depth >= 6 ? 32 : 22) + (luckBoost ? 10 : 0);

  if (roll < legendaryChance) return 'legendary';
  if (roll < legendaryChance + epicChance) return 'epic';
  if (roll < legendaryChance + epicChance + rareChance) return 'rare';
  return 'common';
}

function pickTemplateForCategory(category: ItemCategory, depth: number): ItemTemplate {
  const pool = ITEM_TEMPLATES.filter((t) => t.category === category);
  if (category === 'ore') {
    if (depth <= 3) {
      const r = Math.random();
      return r < 0.54 ? pool[0] : r < 0.87 ? pool[1] : pool[2];
    }
    if (depth <= 9) {
      const r = Math.random();
      return r < 0.25 ? pool[0] : r < 0.68 ? pool[1] : pool[2];
    }
    return Math.random() < 0.35 ? pool[1] : pool[2];
  }

  if (category === 'gem') {
    // Tầng núi lửa tăng tỷ lệ Kim cương; tầng nông vẫn có xác suất nhỏ gặp Kim cương
    if (depth >= 16 && Math.random() < 0.42) {
      return pool.find((t) => t.id === 'gem_diamond') ?? pool[0];
    }
    if (depth <= 5 && Math.random() > 0.12) {
      const regularGems = pool.filter((t) => t.id !== 'gem_diamond');
      return regularGems[Math.floor(Math.random() * regularGems.length)];
    }
    return pool[Math.floor(Math.random() * pool.length)];
  }

  return pool[Math.floor(Math.random() * pool.length)];
}

function rollCategoryForDepth(depth: number): ItemCategory {
  const stratum = getStratum(depth);
  const { ore, gem, relic } = stratum.weights;
  const total = ore + gem + relic;
  let r = Math.random() * total;
  if (r < ore) return 'ore';
  r -= ore;
  if (r < gem) return 'gem';
  return 'relic';
}

function createItemFromCategory(
  category: ItemCategory,
  depth: number,
  bonuses: ComputedBonuses,
  options?: { minRarity?: Rarity; luckBoost?: boolean; day?: number }
): GameItem {
  const tpl = pickTemplateForCategory(category, depth);
  let rarity = rollRarity(depth, Boolean(options?.luckBoost));
  if (options?.minRarity === 'rare' && rarity === 'common') {
    rarity = 'rare';
  }
  const rarityMult = RARITY_INFO[rarity].mult;
  const depthFactor = 1 + depth * 0.055;
  const rawVal = tpl.baseValue * rarityMult * depthFactor * (1 + bonuses.valueBonusPct);

  return {
    uid: makeUid(),
    templateId: tpl.id,
    name: tpl.name,
    category: tpl.category,
    rarity,
    value: Math.max(6, Math.round(rawVal)),
    color: tpl.color,
    gemKind: tpl.gemKind,
    relicSet: tpl.relicSet,
    keepForTribute: true,
    earnedDay: options?.day,
  };
}

function generateDailyMarket(): MarketModifiers {
  const swing = () => {
    const delta = (Math.random() * 2 - 1) * GAME_CONFIG.MARKET_FLUCTUATION;
    return Math.round((1 + delta) * 100) / 100;
  };
  return { ore: swing(), gem: swing(), relic: swing() };
}

function generateDailyShopOffers(day: number): DailyShopOffer[] {
  const shovelDeals: Array<Omit<DailyShopOffer, 'uid' | 'sold'>> = [
    {
      kind: 'shovel_1',
      title: 'Cuốc Đào Dự Phòng (+1 Xẻng Ván Kế)',
      subtitle: 'Thêm 1 lượt xuống hầm cho ngày mai (giảm từ 30 xu)',
      price: 24,
    },
    {
      kind: 'shovel_2',
      title: 'Cặp Cuốc Thép (+2 Xẻng Ván Kế)',
      subtitle: 'Thêm 2 lượt xuống hầm cho ngày mai (giảm từ 60 xu)',
      price: 46,
    },
  ];

  const tacticalDeals: Array<Omit<DailyShopOffer, 'uid' | 'sold'>> = [
    {
      kind: 'time_rewind_discount',
      title: '⏳ Đồng Hồ Cát Thời Gian (Giảm giá)',
      subtitle: 'Quay ngược thời gian khi sập hầm — cứu toàn bộ túi, khiên & chuỗi!',
      price: 58,
    },
    {
      kind: 'dynamite_discount',
      title: '💣 Mìn Phá Đá (Giảm giá)',
      subtitle: 'Phá nổ +1m với 0% nguy cơ sập & chắc chắn ra đồ Hiếm+',
      price: 34,
    },
    {
      kind: 'lucky_compass_discount',
      title: '🧭 La Bàn May Mắn (Ván Kế)',
      subtitle: 'Ngày mai -4% nguy cơ sập & tăng mạnh tỉ lệ đồ Hiếm/Huyền thoại',
      price: 27,
    },
    {
      kind: 'super_lamp_discount',
      title: '🏮 Đèn Dầu Cỡ Lớn (Ván Kế)',
      subtitle: 'Ngày mai soi tầng kế tiếp & tăng +12% giá trị mọi món đào được',
      price: 22,
    },
    {
      kind: 'shield_start',
      title: '🛡️ Bùa Khiên Cột Chống (Ván Kế)',
      subtitle: 'Khởi đầu lượt hầm đầu tiên ngày mai với +2 điểm khiên',
      price: 24,
    },
    {
      kind: 'random_gem',
      title: '💎 Túi Ngọc Bí Ẩn (1 Ngọc vào Kho)',
      subtitle: 'Nhận ngay 1 viên Ngọc ngẫu nhiên để khảm hoặc trưng bày',
      price: day >= 6 ? 48 : 38,
    },
    {
      kind: 'map_discount',
      title: '🗺️ Bản Đồ Mạch Khoáng (Ván Kế)',
      subtitle: 'Ngày mai bắt đầu ngay tại độ sâu 3 m (giảm từ 26 xu)',
      price: 20,
    },
  ];

  // Luôn có 1 ưu đãi xẻng cho ván kế + 2 vật phẩm chiến thuật xoay vòng
  const shovelPick = Math.random() < 0.55 ? shovelDeals[0] : shovelDeals[1];
  const others = tacticalDeals.sort(() => Math.random() - 0.5).slice(0, 2);
  return [shovelPick, ...others].map((o) => ({
    ...o,
    uid: makeUid(),
    sold: false,
  }));
}

function generateMerchantOffers(day: number): MerchantOffer[] {
  if (!isMerchantDay(day)) return [];
  const gemTemplates = ITEM_TEMPLATES.filter((t) => t.category === 'gem');
  const shuffled = [...gemTemplates].sort(() => Math.random() - 0.5).slice(0, 4);

  return shuffled.map((tpl, idx) => {
    const rRoll = Math.random();
    let rarity: Rarity = 'common';
    if (day >= 9) {
      rarity = rRoll < 0.2 ? 'legendary' : rRoll < 0.58 ? 'epic' : 'rare';
    } else if (day >= 6) {
      rarity = rRoll < 0.12 ? 'legendary' : rRoll < 0.45 ? 'epic' : 'rare';
    } else {
      rarity = idx === 0 ? 'rare' : rRoll < 0.22 ? 'epic' : rRoll < 0.72 ? 'rare' : 'common';
    }
    const priceByRarity: Record<Rarity, number> = {
      common: 36,
      rare: 60,
      epic: 96,
      legendary: 148,
    };
    const diamondPremium = tpl.id === 'gem_diamond' ? 16 : 0;
    return {
      uid: makeUid(),
      templateId: tpl.id,
      rarity,
      price: priceByRarity[rarity] + diamondPremium,
      sold: false,
    };
  });
}

function createPurchasedGem(templateId: string, rarity: Rarity, day: number): GameItem {
  const tpl = ITEM_TEMPLATES.find((t) => t.id === templateId) ?? ITEM_TEMPLATES[3];
  const rawVal = tpl.baseValue * RARITY_INFO[rarity].mult * (1 + day * 0.04);
  return {
    uid: makeUid(),
    templateId: tpl.id,
    name: tpl.name,
    category: 'gem',
    rarity,
    value: Math.round(rawVal),
    color: tpl.color,
    gemKind: tpl.gemKind,
    keepForTribute: false,
    notForTribute: true,
    earnedDay: day,
    nonTributeReason: 'purchased',
  };
}

function isItemEligibleForTodayTribute(item: GameItem, currentDay: number): boolean {
  if (item.notForTribute) return false;
  if (typeof item.earnedDay === 'number' && item.earnedDay !== currentDay) return false;
  return true;
}

function getNonTributeReasonLabel(item: GameItem, currentDay: number): string {
  if (item.nonTributeReason === 'purchased') {
    return 'Ngọc mua tại Chợ — không nộp cống được';
  }
  if (
    item.nonTributeReason === 'old_day' ||
    (typeof item.earnedDay === 'number' && item.earnedDay !== currentDay)
  ) {
    return typeof item.earnedDay === 'number'
      ? `Đồ tồn từ Ngày ${item.earnedDay} — chỉ đồ đào hôm nay mới cống được`
      : 'Đồ tồn từ ngày trước — chỉ đồ đào hôm nay mới cống được';
  }
  return 'Đã từng trưng bày / tháo khảm — không nộp cống được';
}

function computeSellPrice(item: GameItem, market: MarketModifiers): number {
  return Math.max(1, Math.round(item.value * market[item.category]));
}

function computeShowcaseIncome(showcase: GameItem[]): number {
  const total = showcase.reduce((sum, item) => sum + item.value, 0);
  return Math.round(total * GAME_CONFIG.PASSIVE_INCOME_RATE);
}

function generateVisitorOrder(day: number): VisitorOrder {
  const names = [
    'Thương nhân Lữ Khách',
    'Nhà Sưu Tầm Cổ Vật',
    'Thợ Kim Hoàn Hoàng Gia',
    'Học Giả Địa Chất',
    'Lái Buôn Đèn Dầu',
  ];
  // Chọn một món ngọc hoặc di vật phù hợp tiến độ ngày
  const candidates = ITEM_TEMPLATES.filter((t) =>
    day <= 2 ? t.category === 'gem' && t.id !== 'gem_diamond' : t.category !== 'ore'
  );
  const target = candidates[Math.floor(Math.random() * candidates.length)];
  const rewardCoins = Math.round(target.baseValue * 1.9 + day * 12);

  return {
    targetTemplateId: target.id,
    targetName: target.name,
    targetCategory: target.category,
    rewardCoins,
    fulfilled: false,
    visitorName: names[(day - 1) % names.length],
  };
}

function describeGemEffect(gemKind: GemKind | undefined, rarity: Rarity): string {
  const p = getGemPowerMultiplier(rarity);
  const bagBonus = getGemBagBonus(gemKind, rarity);
  switch (gemKind) {
    case 'ruby':
      return `+${Math.round(10 * p)}% giá trị đồ · +${bagBonus} ô túi`;
    case 'sapphire':
      return `-${(4.0 * p).toFixed(1)}% nguy cơ sập · +${bagBonus} ô túi`;
    case 'emerald':
      return `+${Math.round(28 * p)}% cơ hội +2 khiên · +${bagBonus} ô túi`;
    case 'diamond':
      return `+${Math.round(14 * p)}% nhân đôi đồ · +${bagBonus} ô túi`;
    case 'amethyst':
      return `Soi tầng kế & +${Math.round(6 * p)}% giá trị · +${bagBonus} ô túi`;
    case 'topaz':
      return `+${bagBonus} ô túi đào & +${Math.round(6 * p)}% giá trị`;
    default:
      return '';
  }
}

function createInitialState(startImmediately = false): GameState {
  return {
    day: 1,
    endlessMode: false,
    phase: startImmediately ? 'MINING' : 'INTRO',
    workshopTab: 'warehouse',
    coins: GAME_CONFIG.START_COINS,
    baseShovels: GAME_CONFIG.START_SHOVELS,
    extraShovelsTomorrow: 0,
    shovelsUsed: 0,
    baseBagSlots: GAME_CONFIG.START_BAG_SLOTS,
    showcaseSlots: GAME_CONFIG.START_SHOWCASE_SLOTS,
    hasMapForToday: false,
    hasMapForTomorrow: false,
    bonusStartShieldToday: 0,
    bonusStartShieldTomorrow: 0,
    luckyDayToday: false,
    luckyDayTomorrow: false,
    superLampToday: false,
    superLampTomorrow: false,
    timeRewinds: 0,
    dynamiteCount: 0,
    inShaft: false,
    depth: 0,
    shieldPoints: 0,
    safeDigStreak: 0,
    bag: [],
    lastOutcomeText: 'Chạm ĐÀO để xuống hầm tìm kho báu.',
    lastFoundItem: null,
    warehouse: [],
    showcase: [],
    collectionRecord: [],
    equipment: {
      shovel: [null, null],
      helmet: [null, null],
      prop: [null, null],
    },
    market: generateDailyMarket(),
    merchantOffers: [],
    dailyShopOffers: generateDailyShopOffers(1),
    visitor: generateVisitorOrder(1),
    stats: {
      totalDug: 0,
      maxDepth: 0,
      collapses: 0,
      shieldSaves: 0,
      rewindsUsed: 0,
      totalCoinsEarned: 0,
    },
  };
}

// ============================================================================
// 4. BỘ TỔNG HỢP ÂM THANH WEBAUDIO (Không dùng file ngoài)
// ============================================================================
class MineAudioEngine {
  private ctx: AudioContext | null = null;
  private muted = false;
  private droneOsc1: OscillatorNode | null = null;
  private droneOsc2: OscillatorNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;
  private droneGain: GainNode | null = null;
  private heartbeatTimer: number | null = null;
  private currentRisk = 0;
  private ambientActive = false;

  public unlock() {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  public setMuted(muted: boolean) {
    this.muted = muted;
    if (this.droneGain && this.ctx) {
      this.droneGain.gain.setTargetAtTime(
        muted || !this.ambientActive ? 0 : 0.055,
        this.ctx.currentTime,
        0.15
      );
    }
    if (muted) {
      this.stopHeartbeat();
    } else if (this.ambientActive && this.currentRisk >= GAME_CONFIG.HEARTBEAT_RISK_THRESHOLD) {
      this.startHeartbeat();
    }
  }

  private ensureDrone() {
    if (!this.ctx || this.droneOsc1) return;
    const now = this.ctx.currentTime;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc1.type = 'triangle';
    osc2.type = 'sine';
    osc1.frequency.setValueAtTime(58, now);
    osc2.frequency.setValueAtTime(116, now);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(190, now);

    gain.gain.setValueAtTime(0, now);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    osc1.start();
    osc2.start();

    this.droneOsc1 = osc1;
    this.droneOsc2 = osc2;
    this.droneFilter = filter;
    this.droneGain = gain;
  }

  public updateAmbient(active: boolean, depth: number, risk: number) {
    this.ambientActive = active;
    this.currentRisk = risk;
    if (!this.ctx) return;

    this.ensureDrone();
    if (!this.droneOsc1 || !this.droneOsc2 || !this.droneFilter || !this.droneGain) return;

    const now = this.ctx.currentTime;
    const stratum = getStratum(depth);
    const freq = stratum.droneFreq + Math.min(depth, 24) * 1.4;
    const cutoff = stratum.droneCutoff + Math.min(depth, 24) * 12;

    this.droneOsc1.frequency.setTargetAtTime(freq, now, 0.35);
    this.droneOsc2.frequency.setTargetAtTime(freq * 1.5, now, 0.35);
    this.droneFilter.frequency.setTargetAtTime(cutoff, now, 0.35);
    this.droneGain.gain.setTargetAtTime(active && !this.muted ? 0.055 : 0, now, 0.25);

    if (active && !this.muted && risk >= GAME_CONFIG.HEARTBEAT_RISK_THRESHOLD) {
      this.startHeartbeat();
    } else {
      this.stopHeartbeat();
    }
  }

  private playHeartbeatPulse() {
    if (!this.ctx || this.muted || !this.ambientActive) return;
    const now = this.ctx.currentTime;
    const playThump = (offset: number, peakGain: number) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(66, now + offset);
      osc.frequency.exponentialRampToValueAtTime(34, now + offset + 0.14);
      g.gain.setValueAtTime(0.001, now + offset);
      g.gain.linearRampToValueAtTime(peakGain, now + offset + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.16);
      osc.connect(g);
      g.connect(this.ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.17);
    };
    const intensity = clamp((this.currentRisk - 25) / 35, 0.2, 1);
    playThump(0, 0.12 * intensity);
    playThump(0.16, 0.08 * intensity);
  }

  private startHeartbeat() {
    if (this.heartbeatTimer !== null) return;
    const tick = () => {
      if (!this.ambientActive || this.muted || this.currentRisk < GAME_CONFIG.HEARTBEAT_RISK_THRESHOLD) {
        this.heartbeatTimer = null;
        return;
      }
      this.playHeartbeatPulse();
      const interval = Math.max(540, 960 - (this.currentRisk - 28) * 11);
      this.heartbeatTimer = window.setTimeout(tick, interval);
    };
    this.heartbeatTimer = window.setTimeout(tick, 180);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer !== null) {
      window.clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // Tiếng xẻng xúc đá & keng kim loại theo ngũ cung tăng dần theo độ sâu (bắt tai hơn)
  public playPickStrike(depth: number, isFrenzy = false) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const pentatonicSemitones = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
    const idx = Math.min(depth, pentatonicSemitones.length - 1);
    const frenzyShift = isFrenzy ? 2 : 1;
    const baseFreq = 310 * frenzyShift * Math.pow(2, pentatonicSemitones[idx] / 12);

    // 1) Tổng các sóng sine không điều hòa: tỷ lệ 1, 2.76, 5.4, 8.93
    const partials = [
      { ratio: 1, amp: 0.17, decay: 0.24 },
      { ratio: 2.76, amp: 0.095, decay: 0.15 },
      { ratio: 5.4, amp: 0.055, decay: 0.1 },
      { ratio: 8.93, amp: 0.03, decay: 0.065 },
    ];
    for (const p of partials) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(baseFreq * p.ratio, now);
      gain.gain.setValueAtTime(p.amp, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + p.decay);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + p.decay + 0.02);
    }

    // 2) Thụp trầm chắc nịch khi lưỡi xẻng cắm xuống đất đá
    const thump = this.ctx.createOscillator();
    const thumpGain = this.ctx.createGain();
    thump.type = 'triangle';
    thump.frequency.setValueAtTime(isFrenzy ? 150 : 122, now);
    thump.frequency.exponentialRampToValueAtTime(44, now + 0.095);
    thumpGain.gain.setValueAtTime(0.24, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    thump.connect(thumpGain);
    thumpGain.connect(this.ctx.destination);
    thump.start(now);
    thump.stop(now + 0.11);

    // 3) Tiếng sỏi đá xào xạc khi xúc đất
    const dur = 0.085;
    const bufLen = Math.floor(this.ctx.sampleRate * dur);
    const buffer = this.ctx.createBuffer(1, bufLen, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufLen * 0.35));
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.setValueAtTime(1.4, now);
    bp.frequency.setValueAtTime(1250, now);
    bp.frequency.exponentialRampToValueAtTime(340, now + dur);
    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.26, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    noise.connect(bp);
    bp.connect(nGain);
    nGain.connect(this.ctx.destination);
    noise.start(now);
  }

  public playFrenzyStart() {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51];
    notes.forEach((f, idx) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = idx === notes.length - 1 ? 'triangle' : 'sine';
      const t = now + idx * 0.045;
      osc.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0.14, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      osc.connect(g);
      g.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.36);
    });
  }

  public playOutcome(kind: 'ore' | 'gem' | 'relic' | 'collapse' | 'shield' | 'coin') {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;

    if (kind === 'ore' || kind === 'coin') {
      // Keng & xu
      const notes = kind === 'coin' ? [1318, 1760] : [987, 1318, 1760];
      notes.forEach((f, idx) => {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, now + idx * 0.055);
        g.gain.setValueAtTime(0.11, now + idx * 0.055);
        g.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.055 + 0.22);
        osc.connect(g);
        g.connect(this.ctx.destination);
        osc.start(now + idx * 0.055);
        osc.stop(now + idx * 0.055 + 0.24);
      });
      return;
    }

    if (kind === 'gem') {
      // Pha lê & chuỗi nốt đi lên
      const chord = [587.33, 783.99, 987.77, 1318.51];
      chord.forEach((f, idx) => {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'sine';
        const t = now + idx * 0.065;
        osc.frequency.setValueAtTime(f, t);
        g.gain.setValueAtTime(0.11, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
        osc.connect(g);
        g.connect(this.ctx.destination);
        osc.start(t);
        osc.stop(t + 0.44);
      });
      return;
    }

    if (kind === 'relic') {
      // Chiêng ngân dài + hợp âm lấp lánh
      const gongPartials = [130.81, 196.0, 361.0, 536.0];
      gongPartials.forEach((f, i) => {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = i === 0 ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(f, now);
        g.gain.setValueAtTime(i === 0 ? 0.16 : 0.07, now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 1.35);
        osc.connect(g);
        g.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 1.4);
      });
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'sine';
        const t = now + 0.1 + i * 0.07;
        osc.frequency.setValueAtTime(f, t);
        g.gain.setValueAtTime(0.09, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
        osc.connect(g);
        g.connect(this.ctx.destination);
        osc.start(t);
        osc.stop(t + 0.72);
      });
      return;
    }

    if (kind === 'shield') {
      // Suýt sập hầm: tiếng đá nứt vỡ ập xuống rồi bị khiên gỗ/thép chặn lại đanh gọn
      const crackDur = 0.22;
      const bufLen = Math.floor(this.ctx.sampleRate * crackDur);
      const buffer = this.ctx.createBuffer(1, bufLen, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufLen; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufLen * 0.35));
      }
      const crackNoise = this.ctx.createBufferSource();
      crackNoise.buffer = buffer;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(520, now);
      bp.frequency.exponentialRampToValueAtTime(140, now + crackDur);
      const cg = this.ctx.createGain();
      cg.gain.setValueAtTime(0.32, now);
      cg.gain.exponentialRampToValueAtTime(0.001, now + crackDur);
      crackNoise.connect(bp);
      bp.connect(cg);
      cg.connect(this.ctx.destination);
      crackNoise.start(now);

      // Cú va chạm nặng + âm vang khiên cứu nguy
      [220, 440, 659.25, 1318.5].forEach((f, i) => {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = i === 0 ? 'triangle' : 'sine';
        const t = now + 0.07 + i * 0.02;
        osc.frequency.setValueAtTime(f, t);
        g.gain.setValueAtTime(i === 0 ? 0.22 : 0.13, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.52);
        osc.connect(g);
        g.connect(this.ctx.destination);
        osc.start(t);
        osc.stop(t + 0.55);
      });
      return;
    }

    if (kind === 'collapse') {
      // Sập hầm thật: tiếng nứt gãy lớn + đá tảng rơi dồn dập + ầm trầm kéo dài
      const dur = 1.25;
      const bufLen = Math.floor(this.ctx.sampleRate * dur);
      const buffer = this.ctx.createBuffer(1, bufLen, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufLen; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufLen * 0.48));
      }
      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(780, now);
      lp.frequency.exponentialRampToValueAtTime(60, now + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.45, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + dur);
      noise.connect(lp);
      lp.connect(g);
      g.connect(this.ctx.destination);
      noise.start(now);

      // 3 tiếng tảng đá rơi dồn dập + tiếng gầm trầm
      [0.02, 0.21, 0.43].forEach((offset, idx) => {
        if (!this.ctx) return;
        const sub = this.ctx.createOscillator();
        const sg = this.ctx.createGain();
        sub.type = idx === 0 ? 'sawtooth' : 'triangle';
        sub.frequency.setValueAtTime(105 - idx * 14, now + offset);
        sub.frequency.exponentialRampToValueAtTime(26, now + offset + 0.38);
        sg.gain.setValueAtTime(0.28 - idx * 0.05, now + offset);
        sg.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.42);
        sub.connect(sg);
        sg.connect(this.ctx.destination);
        sub.start(now + offset);
        sub.stop(now + offset + 0.44);
      });
    }
  }

  public playTimeRewind() {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const notes = [392, 523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((f, idx) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'triangle';
      const t = now + idx * 0.055;
      osc.frequency.setValueAtTime(f * 0.92, t);
      osc.frequency.exponentialRampToValueAtTime(f, t + 0.14);
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.15, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
      osc.connect(g);
      g.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.36);
    });
  }

  public playExplosion() {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const dur = 0.45;
    const bufLen = Math.floor(this.ctx.sampleRate * dur);
    const buffer = this.ctx.createBuffer(1, bufLen, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufLen * 0.25));
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(820, now);
    lp.frequency.exponentialRampToValueAtTime(95, now + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.42, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    noise.connect(lp);
    lp.connect(g);
    g.connect(this.ctx.destination);
    noise.start(now);

    const boom = this.ctx.createOscillator();
    const bg = this.ctx.createGain();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(140, now);
    boom.frequency.exponentialRampToValueAtTime(34, now + 0.32);
    bg.gain.setValueAtTime(0.32, now);
    bg.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
    boom.connect(bg);
    bg.connect(this.ctx.destination);
    boom.start(now);
    boom.stop(now + 0.36);
  }
}

// ============================================================================
// 5. HỆ THỐNG HẠT CANVAS & ĐỒ HỌA SVG THỦ CÔNG (Không dùng ảnh ngoài)
// ============================================================================
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  decay: number;
  gravity: number;
  shape: 'circle' | 'shard';
}

interface FloatingLabel {
  x: number;
  y: number;
  text: string;
  color: string;
  alpha: number;
  vy: number;
}

const ItemSvg: React.FC<{
  templateId: string;
  color: string;
  size?: number;
}> = ({ templateId, color, size = 36 }) => {
  // Quặng
  if (templateId.startsWith('ore_')) {
    return (
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id={`g_${templateId}`} x1="6" y1="6" x2="34" y2="34" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#fff7ed" stopOpacity="0.85" />
            <stop offset="35%" stopColor={color} />
            <stop offset="100%" stopColor="#291d14" />
          </linearGradient>
        </defs>
        <path
          d="M11 8L28 6L35 19L30 33L12 34L5 22L11 8Z"
          fill="#2d231c"
          stroke="#6b5240"
          strokeWidth="1.5"
        />
        <path d="M13 11L26 10L30 20L24 29L13 28L10 19L13 11Z" fill={`url(#g_${templateId})`} />
        <path d="M15 13L22 12L19 18L14 16Z" fill="#ffffff" fillOpacity="0.45" />
        <circle cx="26" cy="24" r="2.2" fill={color} />
      </svg>
    );
  }

  // Ngọc quý
  if (templateId.startsWith('gem_')) {
    const isDiamond = templateId === 'gem_diamond';
    const isEmerald = templateId === 'gem_emerald';
    const isTopaz = templateId === 'gem_topaz';
    return (
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id={`gem_${templateId}`} x1="8" y1="5" x2="32" y2="35" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
            <stop offset="40%" stopColor={color} />
            <stop offset="100%" stopColor="#0f172a" stopOpacity="0.9" />
          </linearGradient>
        </defs>
        {isDiamond ? (
          <>
            <polygon points="12,8 28,8 35,17 20,35 5,17" fill={`url(#gem_${templateId})`} stroke="#e0f2fe" strokeWidth="1.4" />
            <polyline points="5,17 35,17" stroke="#ffffff" strokeOpacity="0.55" strokeWidth="1" />
            <polyline points="12,8 16,17 20,35 24,17 28,8" stroke="#ffffff" strokeOpacity="0.45" strokeWidth="1" />
          </>
        ) : isEmerald ? (
          <>
            <polygon points="12,6 28,6 33,12 33,28 28,34 12,34 7,28 7,12" fill={`url(#gem_${templateId})`} stroke="#a7f3d0" strokeWidth="1.3" />
            <polygon points="15,11 25,11 27,14 27,26 25,29 15,29 13,26 13,14" fill={color} stroke="#ffffff" strokeOpacity="0.45" strokeWidth="1" />
          </>
        ) : isTopaz ? (
          <>
            <polygon points="20,4 33,12 33,28 20,36 7,28 7,12" fill={`url(#gem_${templateId})`} stroke="#fef3c7" strokeWidth="1.3" />
            <polygon points="20,10 27,15 27,25 20,30 13,25 13,15" fill={color} stroke="#ffffff" strokeOpacity="0.5" strokeWidth="1" />
          </>
        ) : (
          <>
            <polygon points="20,4 33,15 28,34 12,34 7,15" fill={`url(#gem_${templateId})`} stroke="#ffffff" strokeOpacity="0.6" strokeWidth="1.3" />
            <polygon points="20,10 27,17 24,29 16,29 13,17" fill={color} fillOpacity="0.7" stroke="#ffffff" strokeOpacity="0.4" strokeWidth="1" />
          </>
        )}
      </svg>
    );
  }

  // Di vật
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <circle cx="20" cy="20" r="16" fill="#22170e" stroke={color} strokeOpacity="0.5" strokeWidth="1.4" />
      {templateId.includes('mask') || templateId.includes('crown') ? (
        <path
          d="M10 28L9 14L15 19L20 10L25 19L31 14L30 28H10Z"
          fill={color}
          stroke="#fef3c7"
          strokeWidth="1.2"
        />
      ) : templateId.includes('scarab') || templateId.includes('seal') ? (
        <>
          <ellipse cx="20" cy="21" rx="8" ry="10" fill={color} stroke="#fef3c7" strokeWidth="1.2" />
          <line x1="20" y1="11" x2="20" y2="31" stroke="#1f140c" strokeWidth="1.4" />
          <path d="M12 17L8 14M28 17L32 14M12 24L8 27M28 24L32 27" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        </>
      ) : templateId.includes('ankh') || templateId.includes('key') ? (
        <>
          <circle cx="20" cy="13" r="5" stroke={color} strokeWidth="2.8" />
          <line x1="20" y1="18" x2="20" y2="32" stroke={color} strokeWidth="2.8" strokeLinecap="round" />
          <line x1="13" y1="22" x2="27" y2="22" stroke={color} strokeWidth="2.6" strokeLinecap="round" />
        </>
      ) : templateId.includes('compass') || templateId.includes('shield') ? (
        <>
          <circle cx="20" cy="20" r="10" stroke={color} strokeWidth="2.2" fill="#2f2216" />
          <polygon points="20,12 23,20 20,28 17,20" fill={color} />
          <circle cx="20" cy="20" r="2" fill="#fffbeb" />
        </>
      ) : templateId.includes('skull') ? (
        <>
          <path d="M12 19C12 13.5 15.5 10 20 10C24.5 10 28 13.5 28 19C28 22 26.5 24 25 25V29H15V25C13.5 24 12 22 12 19Z" fill={color} stroke="#e0f2fe" strokeWidth="1.2" />
          <circle cx="16.5" cy="19" r="2.2" fill="#17100b" />
          <circle cx="23.5" cy="19" r="2.2" fill="#17100b" />
        </>
      ) : (
        <>
          <path d="M14 11H26L28 17L24 30H16L12 17L14 11Z" fill={color} stroke="#fef3c7" strokeWidth="1.2" />
          <line x1="14" y1="18" x2="26" y2="18" stroke="#23160d" strokeWidth="1.5" />
        </>
      )}
    </svg>
  );
};

// SVG Trang bị với 2–4 lỗ khảm tròn viền kim loại ngay trên thân trang bị
const EquipmentSvg: React.FC<{
  slot: EquipSlotId;
  sockets: (GameItem | null)[];
  onSocketTap?: (socketIndex: number) => void;
}> = ({ slot, sockets, onSocketTap }) => {
  const socketLayouts: Record<EquipSlotId, Record<number, Array<{ cx: number; cy: number }>>> = {
    shovel: {
      2: [
        { cx: 56, cy: 52 },
        { cx: 56, cy: 76 },
      ],
      3: [
        { cx: 46, cy: 51 },
        { cx: 66, cy: 51 },
        { cx: 56, cy: 76 },
      ],
      4: [
        { cx: 46, cy: 51 },
        { cx: 66, cy: 51 },
        { cx: 48, cy: 74 },
        { cx: 64, cy: 74 },
      ],
    },
    helmet: {
      2: [
        { cx: 42, cy: 54 },
        { cx: 70, cy: 54 },
      ],
      3: [
        { cx: 34, cy: 55 },
        { cx: 56, cy: 53 },
        { cx: 78, cy: 55 },
      ],
      4: [
        { cx: 34, cy: 56 },
        { cx: 49, cy: 50 },
        { cx: 63, cy: 50 },
        { cx: 78, cy: 56 },
      ],
    },
    prop: {
      2: [
        { cx: 56, cy: 36 },
        { cx: 56, cy: 72 },
      ],
      3: [
        { cx: 56, cy: 34 },
        { cx: 56, cy: 54 },
        { cx: 56, cy: 74 },
      ],
      4: [
        { cx: 45, cy: 38 },
        { cx: 67, cy: 38 },
        { cx: 45, cy: 68 },
        { cx: 67, cy: 68 },
      ],
    },
  };

  const count = clamp(sockets.length, 2, 4);
  const coords = socketLayouts[slot][count] ?? socketLayouts[slot][2];
  const rOuter = sockets.length >= 3 ? 9.5 : 12;
  const rInner = sockets.length >= 3 ? 7 : 9;
  const rGem = sockets.length >= 3 ? 6 : 8;

  return (
    <svg width="112" height="104" viewBox="0 0 112 104" fill="none" className="shrink-0">
      <defs>
        <linearGradient id={`eq_${slot}`} x1="16" y1="10" x2="96" y2="96" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#d4a359" />
          <stop offset="50%" stopColor="#8a6232" />
          <stop offset="100%" stopColor="#463119" />
        </linearGradient>
      </defs>

      {slot === 'shovel' && (
        <g>
          <rect x="52" y="10" width="8" height="32" rx="3" fill="#7c542b" stroke="#b98b4d" strokeWidth="1.5" />
          <path d="M44 10H68" stroke="#c89b54" strokeWidth="4" strokeLinecap="round" />
          <path
            d="M36 40H76L73 74C72 86 56 96 56 96C56 96 40 86 39 74L36 40Z"
            fill={`url(#eq_${slot})`}
            stroke="#e3b96f"
            strokeWidth="2"
          />
        </g>
      )}

      {slot === 'helmet' && (
        <g>
          <path
            d="M24 62C24 36 38 22 56 22C74 22 88 36 88 62H24Z"
            fill={`url(#eq_${slot})`}
            stroke="#e3b96f"
            strokeWidth="2"
          />
          <path d="M18 62H94C94 67 89 71 84 71H28C23 71 18 67 18 62Z" fill="#5e4222" stroke="#d4a359" strokeWidth="1.5" />
          <circle cx="56" cy="34" r="7" fill="#fbbf24" stroke="#fef3c7" strokeWidth="1.5" />
          <circle cx="56" cy="34" r="11" fill="#fbbf24" fillOpacity="0.2" />
        </g>
      )}

      {slot === 'prop' && (
        <g>
          <rect x="30" y="14" width="52" height="10" rx="2" fill="#6b4b28" stroke="#d4a359" strokeWidth="1.6" />
          <rect x="44" y="24" width="24" height="58" rx="3" fill={`url(#eq_${slot})`} stroke="#e3b96f" strokeWidth="2" />
          <rect x="28" y="82" width="56" height="11" rx="2" fill="#5a3e1f" stroke="#d4a359" strokeWidth="1.6" />
        </g>
      )}

      {coords.map((pt, idx) => {
        const gem = sockets[idx];
        return (
          <g
            key={idx}
            onClick={() => onSocketTap?.(idx)}
            className={onSocketTap ? 'cursor-pointer' : undefined}
          >
            {/* Viền kim loại lỗ khảm: làm mờ lỗ đã khảm để phân biệt rõ với lỗ trống & ngọc trong kho */}
            <circle
              cx={pt.cx}
              cy={pt.cy}
              r={rOuter}
              fill="#17100b"
              stroke={gem ? '#6b5c4d' : '#e3b96f'}
              strokeOpacity={gem ? 0.55 : 1}
              strokeWidth={gem ? 1.8 : 2.2}
            />
            <circle
              cx={pt.cx}
              cy={pt.cy}
              r={rInner}
              fill="#0d0906"
              stroke={gem ? '#473c31' : '#7c5a2c'}
              strokeWidth="1"
            />
            {gem ? (
              <g opacity="0.42">
                <circle cx={pt.cx} cy={pt.cy} r={rGem} fill={gem.color} />
                <polygon
                  points={`${pt.cx},${pt.cy - rGem + 2} ${pt.cx + rGem - 2},${pt.cy} ${pt.cx},${pt.cy + rGem - 2} ${pt.cx - rGem + 2},${pt.cy}`}
                  fill="#ffffff"
                  fillOpacity="0.16"
                />
                <circle
                  cx={pt.cx}
                  cy={pt.cy}
                  r={rGem}
                  fill="#0b0806"
                  fillOpacity="0.28"
                />
              </g>
            ) : (
              <path
                d={`M${pt.cx - 3.5} ${pt.cy}H${pt.cx + 3.5}M${pt.cx} ${pt.cy - 3.5}V${pt.cy + 3.5}`}
                stroke="#d6a760"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            )}
          </g>
        );
      })}
    </svg>
  );
};

// Icon xẻng dùng cho thanh chỉ báo (hiển thị 🪏, dùng xong xám / gãy)
const ShovelStatusIcon: React.FC<{ used: boolean; index: number }> = ({ used, index }) => (
  <span
    aria-label={used ? `Xẻng ${index + 1} đã dùng` : `Xẻng ${index + 1} sẵn sàng`}
    className={`relative inline-flex items-center justify-center w-8 h-8 rounded-lg border text-lg select-none transition-all duration-200 ${
      used
        ? 'bg-stone-900/70 border-stone-700/60 grayscale opacity-45 -rotate-12'
        : 'bg-amber-950/50 border-amber-500/45 shadow-[0_0_10px_rgba(245,158,11,0.2)]'
    }`}
  >
    <span role="img" aria-hidden="true">
      🪏
    </span>
    {used && (
      <span
        aria-hidden="true"
        className="absolute inset-x-1 top-1/2 h-[2px] -rotate-45 bg-stone-300/80 rounded-full"
      />
    )}
  </span>
);

// ============================================================================
// 6. COMPONENT CHÍNH: HẦM SÂU
// ============================================================================
export default function App() {
  const [game, setGame] = useState<GameState>(() => {
    try {
      const raw = localStorage.getItem(GAME_CONFIG.STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as GameState;
        if (parsed && typeof parsed.day === 'number' && parsed.equipment) {
          return {
            ...parsed,
            endlessMode: Boolean(parsed.endlessMode),
            safeDigStreak: typeof parsed.safeDigStreak === 'number' ? parsed.safeDigStreak : 0,
            collectionRecord: Array.isArray(parsed.collectionRecord) ? parsed.collectionRecord : [],
            merchantOffers: Array.isArray(parsed.merchantOffers) ? parsed.merchantOffers : [],
            dailyShopOffers: Array.isArray(parsed.dailyShopOffers)
              ? parsed.dailyShopOffers
              : generateDailyShopOffers(parsed.day || 1),
            bonusStartShieldToday:
              typeof parsed.bonusStartShieldToday === 'number' ? parsed.bonusStartShieldToday : 0,
            bonusStartShieldTomorrow:
              typeof parsed.bonusStartShieldTomorrow === 'number'
                ? parsed.bonusStartShieldTomorrow
                : 0,
            luckyDayToday: Boolean(parsed.luckyDayToday),
            luckyDayTomorrow: Boolean(parsed.luckyDayTomorrow),
            superLampToday: Boolean(parsed.superLampToday),
            superLampTomorrow: Boolean(parsed.superLampTomorrow),
            timeRewinds: typeof parsed.timeRewinds === 'number' ? parsed.timeRewinds : 0,
            dynamiteCount: typeof parsed.dynamiteCount === 'number' ? parsed.dynamiteCount : 0,
          };
        }
      }
    } catch {
      // Bỏ qua lỗi đọc lưu trữ
    }
    return createInitialState(false);
  });

  const [muted, setMuted] = useState(false);
  const [isDiggingWait, setIsDiggingWait] = useState(false);
  const [shakeMode, setShakeMode] = useState<'none' | 'light' | 'heavy'>('none');
  const [showRules, setShowRules] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Hoạt ảnh xẻng xúc xuống, thông báo suýt sập/sập hầm, Đồng Hồ Cát & 2 giây đào vô hạn (Frenzy)
  const [strikeAnimKey, setStrikeAnimKey] = useState(0);
  const [shaftAlert, setShaftAlert] = useState<{ kind: 'shield' | 'collapse'; depth: number } | null>(
    null
  );
  const [pendingRewind, setPendingRewind] = useState<RewindSnapshot | null>(null);
  const [frenzyEndsAt, setFrenzyEndsAt] = useState<number | null>(null);
  const [frenzyRemainingMs, setFrenzyRemainingMs] = useState(0);

  // Modal khi túi đầy / xem thuộc tính ngọc & đồ trong lúc đào
  const [overflowItem, setOverflowItem] = useState<GameItem | null>(null);
  const [inspectedMiningItem, setInspectedMiningItem] = useState<GameItem | null>(null);
  // Modal quản lý túi trong lúc đào (xem/bỏ 1 hoặc nhiều món)
  const [showBagDrawer, setShowBagDrawer] = useState(false);
  const [selectedDropUids, setSelectedDropUids] = useState<string[]>([]);
  // Modal khảm ngọc chọn từ trang bị hoặc từ kho
  const [inlayTarget, setInlayTarget] = useState<{
    slot: EquipSlotId;
    socketIdx: number;
  } | null>(null);
  const [gemToInlay, setGemToInlay] = useState<GameItem | null>(null);
  // Modal xem chi tiết / lấy ra / bán món đang đặt trong Tủ kính
  const [showcaseInspectUid, setShowcaseInspectUid] = useState<string | null>(null);

  // Danh sách UID được chọn để nộp cống ở Phase 3
  const [selectedTributeUids, setSelectedTributeUids] = useState<string[]>([]);

  // Lời tiên tri của Thạch anh tím / Đèn dầu lớn cho mét kế tiếp
  const [nextLayerHint, setNextLayerHint] = useState<ItemCategory | null>(null);

  const audioRef = useRef<MineAudioEngine | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const labelsRef = useRef<FloatingLabel[]>([]);
  const digTimerRef = useRef<number | null>(null);
  const reducedMotionRef = useRef<boolean>(false);
  const safeDigStreakRef = useRef<number>(game.safeDigStreak);
  safeDigStreakRef.current = game.safeDigStreak;
  const latestGameRef = useRef<GameState>(game);
  latestGameRef.current = game;

  // Kiểm tra prefers-reduced-motion
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotionRef.current = mq.matches;
    const onChange = (e: MediaQueryListEvent) => {
      reducedMotionRef.current = e.matches;
    };
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  // Đếm ngược 2 giây đào vô hạn (Frenzy)
  useEffect(() => {
    if (!frenzyEndsAt) {
      setFrenzyRemainingMs(0);
      return;
    }
    const tick = () => {
      const rem = frenzyEndsAt - Date.now();
      if (rem <= 0) {
        setFrenzyEndsAt(null);
        setFrenzyRemainingMs(0);
      } else {
        setFrenzyRemainingMs(rem);
      }
    };
    tick();
    const id = window.setInterval(tick, 50);
    return () => window.clearInterval(id);
  }, [frenzyEndsAt]);

  // Tự động lưu vào localStorage
  useEffect(() => {
    try {
      localStorage.setItem(GAME_CONFIG.STORAGE_KEY, JSON.stringify(game));
    } catch {
      // Bỏ qua nếu bộ nhớ đầy
    }
  }, [game]);

  // Tính toán các chỉ số dẫn xuất từ trang bị & tủ kính & bộ sưu tập
  const bonuses = useMemo(
    () => computeBonuses(game.equipment, game.showcase, game.collectionRecord),
    [game.equipment, game.showcase, game.collectionRecord]
  );

  const effectiveBonuses = useMemo<ComputedBonuses>(
    () => ({
      ...bonuses,
      valueBonusPct: bonuses.valueBonusPct + (game.superLampToday ? 0.12 : 0),
      riskReductionPct: bonuses.riskReductionPct + (game.luckyDayToday ? 4 : 0),
      foresightEnabled: bonuses.foresightEnabled || Boolean(game.superLampToday),
    }),
    [bonuses, game.superLampToday, game.luckyDayToday]
  );

  const totalShovelsToday = game.baseShovels + bonuses.setExtraShovels;
  const maxBagSlots =
    game.baseBagSlots + bonuses.inlayExtraBagSlots + bonuses.setExtraBagSlots;
  const isFrenzyActive = frenzyEndsAt !== null && frenzyRemainingMs > 0;
  const currentRisk = useMemo(
    () => (isFrenzyActive ? 0 : computeCollapseRisk(game.depth, effectiveBonuses)),
    [game.depth, effectiveBonuses, isFrenzyActive]
  );
  const currentStratum = useMemo(() => getStratum(game.depth), [game.depth]);
  const tributeRequired = useMemo(() => getTributeForDay(game.day), [game.day]);

  // Cập nhật lựa chọn nộp cống mặc định khi vào Phase TRIBUTE (chỉ chọn đồ đào được trong hôm nay)
  useEffect(() => {
    if (game.phase === 'TRIBUTE') {
      const kept = game.warehouse.filter(
        (i) => isItemEligibleForTodayTribute(i, game.day) && i.keepForTribute !== false
      );
      setSelectedTributeUids(kept.map((i) => i.uid));
    }
  }, [game.phase, game.warehouse, game.day]);

  // Khởi tạo / cập nhật âm thanh nền theo độ sâu & nguy cơ
  const ensureAudioUnlocked = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new MineAudioEngine();
    }
    audioRef.current.unlock();
    audioRef.current.setMuted(muted);
  }, [muted]);

  useEffect(() => {
    if (!audioRef.current) return;
    const active = game.phase === 'MINING' && game.inShaft;
    audioRef.current.updateAmbient(active, game.depth, currentRisk);
  }, [game.phase, game.inShaft, game.depth, currentRisk]);

  // Dọn timer khi unmount
  useEffect(() => {
    return () => {
      if (digTimerRef.current) window.clearTimeout(digTimerRef.current);
    };
  }, []);

  // Vòng lặp vẽ hạt & chữ bay trên Canvas
  useEffect(() => {
    let rafId = 0;
    const render = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const rect = canvas.getBoundingClientRect();
          if (canvas.width !== Math.floor(rect.width) || canvas.height !== Math.floor(rect.height)) {
            canvas.width = Math.max(1, Math.floor(rect.width));
            canvas.height = Math.max(1, Math.floor(rect.height));
          }
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          // Vẽ hạt
          const nextParticles: Particle[] = [];
          for (const p of particlesRef.current) {
            p.x += p.vx;
            p.y += p.vy;
            p.vy += p.gravity;
            p.alpha -= p.decay;
            if (p.alpha > 0.02) {
              nextParticles.push(p);
              ctx.save();
              ctx.globalAlpha = Math.max(0, p.alpha);
              ctx.fillStyle = p.color;
              if (p.shape === 'shard') {
                ctx.translate(p.x, p.y);
                ctx.rotate(p.vx * 0.4);
                ctx.beginPath();
                ctx.moveTo(0, -p.size);
                ctx.lineTo(p.size * 0.8, 0);
                ctx.lineTo(0, p.size);
                ctx.lineTo(-p.size * 0.8, 0);
                ctx.closePath();
                ctx.fill();
              } else {
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fill();
              }
              ctx.restore();
            }
          }
          particlesRef.current = nextParticles;

          // Vẽ chữ bay (+Giá trị / Khiên cứu)
          const nextLabels: FloatingLabel[] = [];
          ctx.font = '700 15px "Be Vietnam Pro", system-ui, sans-serif';
          ctx.textAlign = 'center';
          for (const lbl of labelsRef.current) {
            lbl.y += lbl.vy;
            lbl.alpha -= 0.016;
            if (lbl.alpha > 0.02) {
              nextLabels.push(lbl);
              ctx.save();
              ctx.globalAlpha = Math.max(0, lbl.alpha);
              ctx.fillStyle = '#0d0906';
              ctx.fillText(lbl.text, lbl.x + 1, lbl.y + 1);
              ctx.fillStyle = lbl.color;
              ctx.fillText(lbl.text, lbl.x, lbl.y);
              ctx.restore();
            }
          }
          labelsRef.current = nextLabels;
        }
      }
      rafId = requestAnimationFrame(render);
    };
    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const spawnBurst = useCallback(
    (
      kind: 'strike' | 'ore' | 'gem' | 'relic' | 'collapse' | 'shield',
      color = '#fbbf24',
      labelText?: string
    ) => {
      const canvas = canvasRef.current;
      const w = canvas?.width || 340;
      const h = canvas?.height || 260;
      const cx = w * 0.5;
      const cy = h * 0.52;

      if (!reducedMotionRef.current) {
        const count =
          kind === 'relic'
            ? 42
            : kind === 'collapse'
              ? 48
              : kind === 'gem'
                ? 28
                : kind === 'shield'
                  ? 32
                  : kind === 'ore'
                    ? 20
                    : 14;

        for (let i = 0; i < count; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed =
            kind === 'relic' || kind === 'collapse'
              ? 1.5 + Math.random() * 5.2
              : 1 + Math.random() * 3.5;
          particlesRef.current.push({
            x: cx + (Math.random() - 0.5) * 40,
            y: cy + (Math.random() - 0.5) * 24,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - (kind === 'collapse' ? 0.5 : 1.8),
            size:
              kind === 'gem' || kind === 'relic'
                ? 3 + Math.random() * 4.5
                : 2 + Math.random() * 3.5,
            color:
              kind === 'collapse'
                ? i % 2 === 0
                  ? '#dc2626'
                  : '#78716c'
                : kind === 'shield'
                  ? '#fde047'
                  : kind === 'strike'
                    ? '#fdba74'
                    : color,
            alpha: 1,
            decay: kind === 'relic' ? 0.014 : 0.022,
            gravity: kind === 'collapse' ? 0.14 : 0.08,
            shape: kind === 'gem' || kind === 'relic' || kind === 'collapse' ? 'shard' : 'circle',
          });
        }
      }

      if (labelText) {
        labelsRef.current.push({
          x: cx,
          y: cy - 18,
          text: labelText,
          color,
          alpha: 1,
          vy: -1.1,
        });
      }
    },
    []
  );

  const triggerShake = useCallback((mode: 'light' | 'heavy') => {
    if (reducedMotionRef.current) return;
    setShakeMode(mode);
    window.setTimeout(() => setShakeMode('none'), mode === 'heavy' ? 540 : 300);
  }, []);

  const vibrateDevice = useCallback((pattern: number | number[]) => {
    try {
      navigator.vibrate?.(pattern);
    } catch {
      // Không hỗ trợ rung
    }
  }, []);

  // Lời tiên tri cho tầng kế tiếp khi khảm Thạch anh tím
  const prepareForesight = useCallback(
    (nextDepth: number, foresightOn: boolean) => {
      if (!foresightOn) {
        setNextLayerHint(null);
        return;
      }
      setNextLayerHint(rollCategoryForDepth(nextDepth));
    },
    []
  );

  // ============================================================================
  // 7. HÀNH ĐỘNG CHÍNH TRONG CÁC GIAI ĐOẠN
  // ============================================================================

  const handleToggleMute = () => {
    ensureAudioUnlocked();
    const next = !muted;
    setMuted(next);
    audioRef.current?.setMuted(next);
  };

  const handleStartFromIntro = () => {
    ensureAudioUnlocked();
    audioRef.current?.playOutcome('coin');
    setGame((prev) => ({
      ...prev,
      phase: 'MINING',
    }));
  };

  const handleRestartGame = () => {
    ensureAudioUnlocked();
    if (digTimerRef.current) {
      window.clearTimeout(digTimerRef.current);
      digTimerRef.current = null;
    }
    setIsDiggingWait(false);
    setShaftAlert(null);
    setPendingRewind(null);
    setFrenzyEndsAt(null);
    setFrenzyRemainingMs(0);
    setOverflowItem(null);
    setInspectedMiningItem(null);
    setShowBagDrawer(false);
    setSelectedDropUids([]);
    setShowResetConfirm(false);
    setNextLayerHint(null);
    const fresh = createInitialState(true);
    setGame(fresh);
    try {
      localStorage.setItem(GAME_CONFIG.STORAGE_KEY, JSON.stringify(fresh));
    } catch {
      // ignore
    }
  };

  // Bắt đầu một lượt xuống hầm bằng 1 xẻng (mỗi lượt xẻng mới reset chuỗi đào về 0)
  const handleEnterShaft = () => {
    ensureAudioUnlocked();
    if (isDiggingWait || game.inShaft || pendingRewind) return;
    if (game.shovelsUsed >= totalShovelsToday) return;

    const startDepth = game.hasMapForToday ? GAME_CONFIG.MAP_START_DEPTH : 0;
    const bonusShield = Math.min(GAME_CONFIG.SHIELD_THRESHOLD, game.bonusStartShieldToday ?? 0);
    audioRef.current?.playPickStrike(startDepth, false);
    setStrikeAnimKey((k) => k + 1);
    setShaftAlert(null);
    setFrenzyEndsAt(null);
    setFrenzyRemainingMs(0);
    setSelectedDropUids([]);
    safeDigStreakRef.current = 0;
    prepareForesight(startDepth + 1, effectiveBonuses.foresightEnabled);

    setGame((prev) => ({
      ...prev,
      shovelsUsed: prev.shovelsUsed + 1,
      bonusStartShieldToday: 0,
      inShaft: true,
      depth: startDepth,
      shieldPoints: bonusShield,
      safeDigStreak: 0,
      bag: [],
      lastFoundItem: null,
      lastOutcomeText:
        startDepth > 0
          ? `Theo Bản đồ cổ, bạn xuống thẳng độ sâu ${startDepth} m!`
          : bonusShield > 0
            ? `Bùa Khiên tỏa sáng (+${bonusShield} khiên). Bấm ĐÀO để khai phá!`
            : 'Bạn bước vào miệng hầm tối. Bấm ĐÀO để khai phá.',
    }));
  };

  // Bấm ĐÀO (+1 m) — hỗ trợ chuỗi 10 lần không sập kích hoạt 2 giây đào vô hạn (có điểm khựng nhịp chống spam); suýt sập vẫn GIỮ chuỗi
  const handleDig = () => {
    ensureAudioUnlocked();
    const frenzyNow = frenzyEndsAt !== null && Date.now() < frenzyEndsAt;
    if (isDiggingWait || (overflowItem && !frenzyNow) || pendingRewind) return;

    // Nếu đang ở trên mặt đất thì tự động xuống hầm nếu còn xẻng
    if (!game.inShaft) {
      handleEnterShaft();
      return;
    }

    if (!frenzyNow && game.bag.length >= maxBagSlots) {
      setShowBagDrawer(true);
      return;
    }

    const nextDepth = game.depth + 1;
    const riskAtStep = frenzyNow ? 0 : computeCollapseRisk(nextDepth, effectiveBonuses);
    const delayMs = frenzyNow
      ? GAME_CONFIG.FRENZY_DIG_COOLDOWN_MS
      : computeRevealDelayMs(riskAtStep);

    setShaftAlert(null);
    setStrikeAnimKey((k) => k + 1);
    audioRef.current?.playPickStrike(nextDepth, frenzyNow);
    spawnBurst('strike', frenzyNow ? '#fde047' : '#fdba74');
    vibrateDevice(frenzyNow ? 10 : 18);

    const plannedCategory: ItemCategory = nextLayerHint ?? rollCategoryForDepth(nextDepth);

    const resolveDigStep = () => {
      setIsDiggingWait(false);
      const currentSnapshot = latestGameRef.current;
      const collapsed = !frenzyNow && Math.random() * 100 < riskAtStep;

      if (collapsed) {
        if (currentSnapshot.shieldPoints >= GAME_CONFIG.SHIELD_THRESHOLD) {
          // Cột chống tự cứu một lần sập — GIỮ NGUYÊN chuỗi đào an toàn!
          const preservedStreak = safeDigStreakRef.current;
          audioRef.current?.playOutcome('shield');
          spawnBurst('shield', '#fde047', 'SUÝT SẬP! GIỮ CHUỖI');
          triggerShake('light');
          vibrateDevice([45, 30, 70]);
          setShaftAlert({ kind: 'shield', depth: nextDepth });

          setGame((prev) => ({
            ...prev,
            depth: nextDepth,
            shieldPoints: 0,
            safeDigStreak: preservedStreak,
            lastFoundItem: null,
            lastOutcomeText: `Suýt sập hầm ở ${nextDepth} m! Cột chống đỡ đòn thành công — giữ nguyên chuỗi ${preservedStreak}/${GAME_CONFIG.FRENZY_STREAK_REQUIRED}!`,
            stats: {
              ...prev.stats,
              maxDepth: Math.max(prev.stats.maxDepth, nextDepth),
              shieldSaves: prev.stats.shieldSaves + 1,
            },
          }));
          prepareForesight(nextDepth + 1, effectiveBonuses.foresightEnabled);
          return;
        }

        // Sập hầm thật: nếu có Đồng Hồ Cát Thời Gian, lưu lại khoảnh khắc để người chơi chọn Quay Ngược
        if ((currentSnapshot.timeRewinds ?? 0) > 0) {
          setPendingRewind({
            depth: currentSnapshot.depth,
            shieldPoints: currentSnapshot.shieldPoints,
            safeDigStreak: safeDigStreakRef.current,
            bag: [...currentSnapshot.bag],
            lastFoundItem: currentSnapshot.lastFoundItem,
            collapsedAtDepth: nextDepth,
            lostCount: currentSnapshot.bag.length,
          });
        }

        audioRef.current?.playOutcome('collapse');
        spawnBurst('collapse', '#ef4444', 'SẬP HẦM!');
        triggerShake('heavy');
        vibrateDevice([120, 60, 180]);
        setShaftAlert({ kind: 'collapse', depth: nextDepth });
        setNextLayerHint(null);
        setSelectedDropUids([]);
        safeDigStreakRef.current = 0;

        setGame((prev) => ({
          ...prev,
          inShaft: false,
          depth: 0,
          shieldPoints: 0,
          safeDigStreak: 0,
          bag: [],
          lastFoundItem: null,
          lastOutcomeText: `Sập hầm ở độ sâu ${nextDepth} m! Mất sạch đồ trong túi lượt này.`,
          stats: {
            ...prev.stats,
            maxDepth: Math.max(prev.stats.maxDepth, nextDepth),
            collapses: prev.stats.collapses + 1,
          },
        }));
        return;
      }

      // Đào an toàn (không sập) — mọi loại đá/ngọc/di vật đều TĂNG chuỗi bình thường!
      const nextStreakRaw = frenzyNow ? 0 : safeDigStreakRef.current + 1;
      const triggeredFrenzy = !frenzyNow && nextStreakRaw >= GAME_CONFIG.FRENZY_STREAK_REQUIRED;
      const nextStreak = triggeredFrenzy ? 0 : nextStreakRaw;
      safeDigStreakRef.current = nextStreak;

      if (triggeredFrenzy) {
        const endTs = Date.now() + GAME_CONFIG.FRENZY_DURATION_MS;
        setFrenzyEndsAt(endTs);
        setFrenzyRemainingMs(GAME_CONFIG.FRENZY_DURATION_MS);
        audioRef.current?.playFrenzyStart();
        spawnBurst('relic', '#fbbf24', '⚡ 2s ĐÀO VÔ HẠN!');
        triggerShake('light');
        vibrateDevice([40, 30, 60, 30, 90]);
      }

      // Tích khiên
      const bonusShield = Math.random() < effectiveBonuses.extraShieldChance ? 2 : 1;
      const nextShield = Math.min(
        GAME_CONFIG.SHIELD_THRESHOLD,
        currentSnapshot.shieldPoints + bonusShield
      );

      // Rơi vật phẩm (không bao giờ rơi đá vụn)
      const foundItem = createItemFromCategory(plannedCategory, nextDepth, effectiveBonuses, {
        luckBoost: Boolean(currentSnapshot.luckyDayToday),
        day: currentSnapshot.day,
      });
      const isDoubled = Math.random() < effectiveBonuses.doubleDropChance;
      const itemsToAdd: GameItem[] = isDoubled
        ? [foundItem, { ...foundItem, uid: makeUid() }]
        : [foundItem];

      if (!frenzyNow) audioRef.current?.playOutcome(foundItem.category);
      spawnBurst(
        foundItem.category,
        foundItem.color,
        isDoubled
          ? `x2 ${foundItem.name} (+${foundItem.value * 2})`
          : `+${foundItem.value} giá trị`
      );
      if (!frenzyNow && (foundItem.category === 'gem' || foundItem.category === 'relic')) {
        triggerShake('light');
        vibrateDevice(foundItem.category === 'relic' ? [35, 25, 50] : 28);
      }
      prepareForesight(nextDepth + 1, effectiveBonuses.foresightEnabled);

      setGame((prev) => {
        const spaceLeft = Math.max(0, maxBagSlots - prev.bag.length);
        const accepted = itemsToAdd.slice(0, spaceLeft);
        const leftover = itemsToAdd.slice(spaceLeft);

        // Trong 2s đào vô hạn, nếu túi đầy thì gửi thẳng đồ dư về Kho để không bị modal làm ngắt nhịp!
        let extraWarehouse: GameItem[] = [];
        if (leftover.length > 0) {
          if (frenzyNow) {
            extraWarehouse = leftover;
          } else {
            setOverflowItem(leftover[0]);
          }
        }

        const frenzyNote = triggeredFrenzy
          ? '⚡ Chuỗi 10! KÍCH HOẠT 2 GIÂY ĐÀO VÔ HẠN — '
          : frenzyNow
            ? '⚡ '
            : '';

        return {
          ...prev,
          depth: nextDepth,
          shieldPoints: nextShield,
          safeDigStreak: nextStreak,
          bag: [...prev.bag, ...accepted],
          warehouse:
            extraWarehouse.length > 0 ? [...prev.warehouse, ...extraWarehouse] : prev.warehouse,
          lastFoundItem: foundItem,
          lastOutcomeText: isDoubled
            ? `${frenzyNote}Nhân đôi ${foundItem.name} (${RARITY_INFO[foundItem.rarity].label})!`
            : `${frenzyNote}Đào được ${foundItem.name} (${RARITY_INFO[foundItem.rarity].label}) ở ${nextDepth} m.${extraWarehouse.length > 0 ? ' (Túi đầy → gửi thẳng Kho)' : ''}`,
          stats: {
            ...prev.stats,
            totalDug: prev.stats.totalDug + accepted.length + extraWarehouse.length,
            maxDepth: Math.max(prev.stats.maxDepth, nextDepth),
          },
        };
      });
    };

    if (delayMs <= 0) {
      resolveDigStep();
      return;
    }

    setIsDiggingWait(true);
    digTimerRef.current = window.setTimeout(resolveDigStep, delayMs);
  };

  // Kích hoạt Đồng Hồ Cát Thời Gian khi vừa sập hầm
  const handleConfirmTimeRewind = () => {
    ensureAudioUnlocked();
    if (!pendingRewind || (game.timeRewinds ?? 0) <= 0) return;
    const snap = pendingRewind;
    setPendingRewind(null);
    setShaftAlert(null);
    safeDigStreakRef.current = snap.safeDigStreak;
    audioRef.current?.playTimeRewind();
    spawnBurst('relic', '#38bdf8', '⏳ QUAY NGƯỢC THỜI GIAN!');
    triggerShake('light');
    vibrateDevice([35, 25, 70]);
    prepareForesight(snap.depth + 1, effectiveBonuses.foresightEnabled);

    setGame((prev) => ({
      ...prev,
      timeRewinds: Math.max(0, (prev.timeRewinds ?? 0) - 1),
      inShaft: true,
      depth: snap.depth,
      shieldPoints: snap.shieldPoints,
      safeDigStreak: snap.safeDigStreak,
      bag: snap.bag,
      lastFoundItem: snap.lastFoundItem,
      lastOutcomeText: `⏳ Đồng Hồ Cát tua ngược về ${snap.depth} m! Giữ nguyên ${snap.bag.length} món & chuỗi ${snap.safeDigStreak}/${GAME_CONFIG.FRENZY_STREAK_REQUIRED}.`,
      stats: {
        ...prev.stats,
        collapses: Math.max(0, prev.stats.collapses - 1),
        rewindsUsed: (prev.stats.rewindsUsed ?? 0) + 1,
      },
    }));
  };

  const handleDeclineTimeRewind = () => {
    setPendingRewind(null);
  };

  // Kích hoạt Mìn Phá Đá trong hầm: +1m với 0% nguy cơ sập, chắc chắn ra đồ Hiếm+ & +1 chuỗi
  const handleUseDynamite = () => {
    ensureAudioUnlocked();
    if (!game.inShaft || isDiggingWait || isFrenzyActive || overflowItem || pendingRewind) return;
    if ((game.dynamiteCount ?? 0) <= 0) return;
    if (game.bag.length >= maxBagSlots) {
      setShowBagDrawer(true);
      return;
    }

    const nextDepth = game.depth + 1;
    setShaftAlert(null);
    setStrikeAnimKey((k) => k + 1);
    audioRef.current?.playExplosion();
    triggerShake('heavy');
    vibrateDevice([60, 30, 60]);

    const nextStreakRaw = safeDigStreakRef.current + 1;
    const triggeredFrenzy = nextStreakRaw >= GAME_CONFIG.FRENZY_STREAK_REQUIRED;
    const nextStreak = triggeredFrenzy ? 0 : nextStreakRaw;
    safeDigStreakRef.current = nextStreak;

    if (triggeredFrenzy) {
      const endTs = Date.now() + GAME_CONFIG.FRENZY_DURATION_MS;
      setFrenzyEndsAt(endTs);
      setFrenzyRemainingMs(GAME_CONFIG.FRENZY_DURATION_MS);
      audioRef.current?.playFrenzyStart();
      spawnBurst('relic', '#fbbf24', '⚡ 2s ĐÀO VÔ HẠN!');
    }

    const bonusShield = Math.random() < effectiveBonuses.extraShieldChance ? 2 : 1;
    const nextShield = Math.min(GAME_CONFIG.SHIELD_THRESHOLD, game.shieldPoints + bonusShield);
    const chosenCategory: ItemCategory =
      nextLayerHint ?? (Math.random() < 0.6 ? 'gem' : 'relic');
    const foundItem = createItemFromCategory(chosenCategory, nextDepth, effectiveBonuses, {
      minRarity: 'rare',
      luckBoost: true,
      day: game.day,
    });
    const isDoubled = Math.random() < effectiveBonuses.doubleDropChance;
    const itemsToAdd: GameItem[] = isDoubled
      ? [foundItem, { ...foundItem, uid: makeUid() }]
      : [foundItem];

    audioRef.current?.playOutcome(foundItem.category);
    spawnBurst(
      foundItem.category,
      foundItem.color,
      isDoubled ? `💣 x2 ${foundItem.name}` : `💣 +${foundItem.value} giá trị`
    );
    prepareForesight(nextDepth + 1, effectiveBonuses.foresightEnabled);

    setGame((prev) => {
      const spaceLeft = Math.max(0, maxBagSlots - prev.bag.length);
      const accepted = itemsToAdd.slice(0, spaceLeft);
      const leftover = itemsToAdd.slice(spaceLeft);
      if (leftover.length > 0) {
        setOverflowItem(leftover[0]);
      }

      return {
        ...prev,
        dynamiteCount: Math.max(0, (prev.dynamiteCount ?? 0) - 1),
        depth: nextDepth,
        shieldPoints: nextShield,
        safeDigStreak: nextStreak,
        bag: [...prev.bag, ...accepted],
        lastFoundItem: foundItem,
        lastOutcomeText: `💣 Nổ mìn an toàn ở ${nextDepth} m! Phá ra ${foundItem.name} (${RARITY_INFO[foundItem.rarity].label}).`,
        stats: {
          ...prev.stats,
          totalDug: prev.stats.totalDug + accepted.length,
          maxDepth: Math.max(prev.stats.maxDepth, nextDepth),
        },
      };
    });
  };

  // Bấm LÊN (Thu hoạch về Kho & kết thúc lượt xẻng -> reset chuỗi đào)
  const handleAscend = () => {
    ensureAudioUnlocked();
    if (!game.inShaft || isDiggingWait || pendingRewind) return;
    setFrenzyEndsAt(null);
    setFrenzyRemainingMs(0);
    setShaftAlert(null);
    audioRef.current?.playOutcome('coin');
    setNextLayerHint(null);
    setOverflowItem(null);
    setSelectedDropUids([]);
    safeDigStreakRef.current = 0;

    setGame((prev) => {
      const count = prev.bag.length;
      return {
        ...prev,
        inShaft: false,
        depth: 0,
        shieldPoints: 0,
        safeDigStreak: 0,
        warehouse: [...prev.warehouse, ...prev.bag],
        bag: [],
        lastFoundItem: null,
        lastOutcomeText:
          count > 0
            ? `Lên mặt đất an toàn! Đã cất ${count} món vào Kho.`
            : 'Bạn quay lên mặt đất an toàn.',
      };
    });
  };

  // Chuyển sang Xưởng phân loại sau khi dùng hết xẻng
  const handleGoToWorkshop = () => {
    ensureAudioUnlocked();
    if (game.inShaft || isDiggingWait || pendingRewind) return;
    audioRef.current?.playOutcome('ore');
    setGame((prev) => ({
      ...prev,
      phase: 'WORKSHOP',
      workshopTab: 'warehouse',
    }));
  };

  // Bỏ 1 đồ trong túi (bất cứ lúc nào trong lúc đào, kể cả khi túi chưa đầy)
  const handleDropBagItem = (uid: string) => {
    ensureAudioUnlocked();
    setSelectedDropUids((prev) => prev.filter((id) => id !== uid));
    setGame((prev) => {
      const filtered = prev.bag.filter((i) => i.uid !== uid);
      const nextLast = prev.lastFoundItem?.uid === uid ? null : prev.lastFoundItem;
      if (overflowItem) {
        const accepted = overflowItem;
        setOverflowItem(null);
        return {
          ...prev,
          bag: [...filtered, accepted],
          lastFoundItem: accepted,
          stats: { ...prev.stats, totalDug: prev.stats.totalDug + 1 },
        };
      }
      return { ...prev, bag: filtered, lastFoundItem: nextLast };
    });
  };

  // Chọn nhiều món trong túi để bỏ cùng lúc
  const handleToggleDropUid = (uid: string) => {
    setSelectedDropUids((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
    );
  };

  const handleDropSelectedBagItems = () => {
    ensureAudioUnlocked();
    if (selectedDropUids.length === 0) return;
    const dropSet = new Set(selectedDropUids);
    setSelectedDropUids([]);
    setGame((prev) => ({
      ...prev,
      bag: prev.bag.filter((i) => !dropSet.has(i.uid)),
      lastFoundItem:
        prev.lastFoundItem && dropSet.has(prev.lastFoundItem.uid) ? null : prev.lastFoundItem,
    }));
  };

  // Kho: Đánh dấu giữ để nộp cống / Bán xu / Trưng bày / Khảm
  const handleSellWarehouseItem = (uid: string) => {
    ensureAudioUnlocked();
    const target = game.warehouse.find((i) => i.uid === uid);
    if (!target) return;
    const gain = computeSellPrice(target, game.market);
    audioRef.current?.playOutcome('coin');
    setGame((prev) => ({
      ...prev,
      coins: prev.coins + gain,
      warehouse: prev.warehouse.filter((i) => i.uid !== uid),
      stats: {
        ...prev.stats,
        totalCoinsEarned: prev.stats.totalCoinsEarned + gain,
      },
    }));
  };

  const handleDisplayItem = (uid: string) => {
    ensureAudioUnlocked();
    if (game.showcase.length >= game.showcaseSlots) return;
    const target = game.warehouse.find((i) => i.uid === uid);
    if (!target) return;
    audioRef.current?.playOutcome('gem');
    setGame((prev) => ({
      ...prev,
      warehouse: prev.warehouse.filter((i) => i.uid !== uid),
      showcase: [...prev.showcase, { ...target, keepForTribute: false, notForTribute: true }],
    }));
  };

  // Lấy vật phẩm từ Tủ kính về lại Kho (để bán/khảm/lưu, không thể nộp cống)
  const handleTakeFromShowcase = (uid: string) => {
    ensureAudioUnlocked();
    const target = game.showcase.find((i) => i.uid === uid);
    if (!target) return;
    audioRef.current?.playOutcome('ore');
    setShowcaseInspectUid(null);
    setGame((prev) => ({
      ...prev,
      showcase: prev.showcase.filter((i) => i.uid !== uid),
      warehouse: [
        ...prev.warehouse,
        {
          ...target,
          keepForTribute: false,
          notForTribute: true,
          nonTributeReason: 'unmounted_or_showcase',
        },
      ],
    }));
  };

  // Bán trực tiếp vật phẩm đang đặt trong Tủ kính
  const handleSellShowcaseItem = (uid: string) => {
    ensureAudioUnlocked();
    const target = game.showcase.find((i) => i.uid === uid);
    if (!target) return;
    const gain = computeSellPrice(target, game.market);
    audioRef.current?.playOutcome('coin');
    setShowcaseInspectUid(null);
    setGame((prev) => ({
      ...prev,
      coins: prev.coins + gain,
      showcase: prev.showcase.filter((i) => i.uid !== uid),
      stats: {
        ...prev.stats,
        totalCoinsEarned: prev.stats.totalCoinsEarned + gain,
      },
    }));
  };

  // Hiến di vật vào Sổ Bộ Sưu Tập để ghi nhận vĩnh viễn và giải phóng ô Kho/Tủ
  const handleRecordRelic = (uid: string, source: 'warehouse' | 'showcase') => {
    ensureAudioUnlocked();
    const list = source === 'warehouse' ? game.warehouse : game.showcase;
    const target = list.find((i) => i.uid === uid);
    if (!target || target.category !== 'relic') return;
    if (game.collectionRecord.includes(target.templateId)) return;

    audioRef.current?.playOutcome('relic');
    setShowcaseInspectUid(null);
    setGame((prev) => ({
      ...prev,
      warehouse:
        source === 'warehouse' ? prev.warehouse.filter((i) => i.uid !== uid) : prev.warehouse,
      showcase:
        source === 'showcase' ? prev.showcase.filter((i) => i.uid !== uid) : prev.showcase,
      collectionRecord: [...prev.collectionRecord, target.templateId],
    }));
  };

  const handleToggleKeepForTribute = (uid: string) => {
    ensureAudioUnlocked();
    setGame((prev) => ({
      ...prev,
      warehouse: prev.warehouse.map((i) =>
        i.uid === uid && isItemEligibleForTodayTribute(i, prev.day)
          ? { ...i, keepForTribute: i.keepForTribute === false ? true : false }
          : i
      ),
    }));
  };

  // Khách tham quan thưởng xu nếu tủ trưng bày có món họ cần
  const matchingVisitorShowcaseItem = useMemo(() => {
    if (!game.visitor || game.visitor.fulfilled) return null;
    return (
      game.showcase.find((item) => item.templateId === game.visitor?.targetTemplateId) ?? null
    );
  }, [game.visitor, game.showcase]);

  const handleFulfillVisitor = () => {
    ensureAudioUnlocked();
    if (!game.visitor || game.visitor.fulfilled || !matchingVisitorShowcaseItem) return;
    const reward = game.visitor.rewardCoins;
    audioRef.current?.playOutcome('relic');
    setGame((prev) => ({
      ...prev,
      coins: prev.coins + reward,
      visitor: prev.visitor ? { ...prev.visitor, fulfilled: true } : null,
      stats: {
        ...prev.stats,
        totalCoinsEarned: prev.stats.totalCoinsEarned + reward,
      },
    }));
  };

  // Khảm ngọc vào lỗ trang bị
  const handleSocketGem = (slot: EquipSlotId, socketIdx: number, gem: GameItem) => {
    ensureAudioUnlocked();
    if (gem.category !== 'gem') return;
    if (game.equipment[slot][socketIdx] !== null) return;
    audioRef.current?.playOutcome('gem');
    setInlayTarget(null);
    setGemToInlay(null);

    setGame((prev) => {
      const nextSlotArr = [...prev.equipment[slot]];
      nextSlotArr[socketIdx] = gem;
      return {
        ...prev,
        warehouse: prev.warehouse.filter((i) => i.uid !== gem.uid),
        equipment: {
          ...prev.equipment,
          [slot]: nextSlotArr,
        },
      };
    });
  };

  // Tháo ngọc đã khảm (tốn phí xu, trả ngọc về Kho nhưng không được dùng nộp cống)
  const handleRemoveGem = (slot: EquipSlotId, socketIdx: number) => {
    ensureAudioUnlocked();
    const gem = game.equipment[slot][socketIdx];
    if (!gem || game.coins < GAME_CONFIG.SHOP_PRICES.removeGem) return;
    audioRef.current?.playOutcome('ore');

    setGame((prev) => {
      const nextSlotArr = [...prev.equipment[slot]];
      nextSlotArr[socketIdx] = null;
      return {
        ...prev,
        coins: prev.coins - GAME_CONFIG.SHOP_PRICES.removeGem,
        warehouse: [
          ...prev.warehouse,
          {
            ...gem,
            keepForTribute: false,
            notForTribute: true,
            nonTributeReason: 'unmounted_or_showcase',
          },
        ],
        equipment: {
          ...prev.equipment,
          [slot]: nextSlotArr,
        },
      };
    });
  };

  // Chợ: Mua nâng cấp & vật phẩm chiến thuật (chỉ mua ở Xưởng -> Chợ, xẻng/bùa áp dụng cho ván kế)
  const handleBuyUpgrade = (
    kind: 'shovel' | 'bag' | 'showcase' | 'map' | 'timeRewind' | 'dynamite' | 'luckyCompass' | 'superLamp'
  ) => {
    ensureAudioUnlocked();
    if (kind === 'shovel') {
      if (game.coins < GAME_CONFIG.SHOP_PRICES.extraShovel) return;
      audioRef.current?.playOutcome('coin');
      setGame((prev) => ({
        ...prev,
        coins: prev.coins - GAME_CONFIG.SHOP_PRICES.extraShovel,
        extraShovelsTomorrow: prev.extraShovelsTomorrow + 1,
      }));
    } else if (kind === 'bag') {
      if (game.coins < GAME_CONFIG.SHOP_PRICES.bagSlot) return;
      audioRef.current?.playOutcome('coin');
      setGame((prev) => ({
        ...prev,
        coins: prev.coins - GAME_CONFIG.SHOP_PRICES.bagSlot,
        baseBagSlots: prev.baseBagSlots + 1,
      }));
    } else if (kind === 'showcase') {
      if (
        game.coins < GAME_CONFIG.SHOP_PRICES.showcaseSlot ||
        game.showcaseSlots >= GAME_CONFIG.MAX_SHOWCASE_SLOTS
      ) {
        return;
      }
      audioRef.current?.playOutcome('coin');
      setGame((prev) => ({
        ...prev,
        coins: prev.coins - GAME_CONFIG.SHOP_PRICES.showcaseSlot,
        showcaseSlots: prev.showcaseSlots + 1,
      }));
    } else if (kind === 'map') {
      if (game.coins < GAME_CONFIG.SHOP_PRICES.map || game.hasMapForTomorrow) return;
      audioRef.current?.playOutcome('coin');
      setGame((prev) => ({
        ...prev,
        coins: prev.coins - GAME_CONFIG.SHOP_PRICES.map,
        hasMapForTomorrow: true,
      }));
    } else if (kind === 'timeRewind') {
      if (game.coins < GAME_CONFIG.SHOP_PRICES.timeRewind) return;
      audioRef.current?.playOutcome('relic');
      setGame((prev) => ({
        ...prev,
        coins: prev.coins - GAME_CONFIG.SHOP_PRICES.timeRewind,
        timeRewinds: (prev.timeRewinds ?? 0) + 1,
      }));
    } else if (kind === 'dynamite') {
      if (game.coins < GAME_CONFIG.SHOP_PRICES.dynamite) return;
      audioRef.current?.playOutcome('ore');
      setGame((prev) => ({
        ...prev,
        coins: prev.coins - GAME_CONFIG.SHOP_PRICES.dynamite,
        dynamiteCount: (prev.dynamiteCount ?? 0) + 1,
      }));
    } else if (kind === 'luckyCompass') {
      if (game.coins < GAME_CONFIG.SHOP_PRICES.luckyCompass || game.luckyDayTomorrow) return;
      audioRef.current?.playOutcome('gem');
      setGame((prev) => ({
        ...prev,
        coins: prev.coins - GAME_CONFIG.SHOP_PRICES.luckyCompass,
        luckyDayTomorrow: true,
      }));
    } else if (kind === 'superLamp') {
      if (game.coins < GAME_CONFIG.SHOP_PRICES.superLamp || game.superLampTomorrow) return;
      audioRef.current?.playOutcome('gem');
      setGame((prev) => ({
        ...prev,
        coins: prev.coins - GAME_CONFIG.SHOP_PRICES.superLamp,
        superLampTomorrow: true,
      }));
    }
  };

  // Thương nhân lưu động (mỗi 3 ngày): Mua ngọc khảm & Mở rộng lỗ khảm trang bị
  const merchantActiveToday = isMerchantDay(game.day);
  const nextMerchantDay = getNextMerchantDay(game.day);

  const handleBuyMerchantGem = (offerUid: string) => {
    ensureAudioUnlocked();
    if (!merchantActiveToday) return;
    const offer = game.merchantOffers.find((o) => o.uid === offerUid);
    if (!offer || offer.sold || game.coins < offer.price) return;
    const newGem = createPurchasedGem(offer.templateId, offer.rarity, game.day);
    audioRef.current?.playOutcome('gem');

    setGame((prev) => ({
      ...prev,
      coins: prev.coins - offer.price,
      warehouse: [...prev.warehouse, newGem],
      merchantOffers: prev.merchantOffers.map((o) =>
        o.uid === offerUid ? { ...o, sold: true } : o
      ),
    }));
  };

  const handleUpgradeEquipSocket = (slot: EquipSlotId) => {
    ensureAudioUnlocked();
    if (!merchantActiveToday) return;
    const currentLen = game.equipment[slot].length;
    if (currentLen >= GAME_CONFIG.MAX_SOCKETS_PER_EQUIP) return;
    const cost = GAME_CONFIG.SOCKET_UPGRADE_COSTS[currentLen] ?? 95;
    if (game.coins < cost) return;
    audioRef.current?.playOutcome('relic');

    setGame((prev) => ({
      ...prev,
      coins: prev.coins - cost,
      equipment: {
        ...prev.equipment,
        [slot]: [...prev.equipment[slot], null],
      },
    }));
  };

  const handleBuyDailyOffer = (offerUid: string) => {
    ensureAudioUnlocked();
    const offer = game.dailyShopOffers.find((o) => o.uid === offerUid);
    if (!offer || offer.sold || game.coins < offer.price) return;

    audioRef.current?.playOutcome(
      offer.kind === 'random_gem' || offer.kind === 'time_rewind_discount' ? 'gem' : 'coin'
    );
    setGame((prev) => {
      let extraShovelsTomorrow = prev.extraShovelsTomorrow;
      let bonusStartShieldTomorrow = prev.bonusStartShieldTomorrow ?? 0;
      let hasMapForTomorrow = prev.hasMapForTomorrow;
      let luckyDayTomorrow = Boolean(prev.luckyDayTomorrow);
      let superLampTomorrow = Boolean(prev.superLampTomorrow);
      let timeRewinds = prev.timeRewinds ?? 0;
      let dynamiteCount = prev.dynamiteCount ?? 0;
      let warehouse = prev.warehouse;

      if (offer.kind === 'shovel_1') {
        extraShovelsTomorrow += 1;
      } else if (offer.kind === 'shovel_2') {
        extraShovelsTomorrow += 2;
      } else if (offer.kind === 'shield_start') {
        bonusStartShieldTomorrow = Math.min(
          GAME_CONFIG.SHIELD_THRESHOLD,
          bonusStartShieldTomorrow + 2
        );
      } else if (offer.kind === 'map_discount') {
        hasMapForTomorrow = true;
      } else if (offer.kind === 'time_rewind_discount') {
        timeRewinds += 1;
      } else if (offer.kind === 'dynamite_discount') {
        dynamiteCount += 1;
      } else if (offer.kind === 'lucky_compass_discount') {
        luckyDayTomorrow = true;
      } else if (offer.kind === 'super_lamp_discount') {
        superLampTomorrow = true;
      } else if (offer.kind === 'random_gem') {
        const gemTpls = ITEM_TEMPLATES.filter((t) => t.category === 'gem');
        const picked = gemTpls[Math.floor(Math.random() * gemTpls.length)];
        const rarity: Rarity = Math.random() < 0.3 ? 'epic' : Math.random() < 0.72 ? 'rare' : 'common';
        warehouse = [...warehouse, createPurchasedGem(picked.id, rarity, prev.day)];
      }

      return {
        ...prev,
        coins: prev.coins - offer.price,
        extraShovelsTomorrow,
        bonusStartShieldTomorrow,
        hasMapForTomorrow,
        luckyDayTomorrow,
        superLampTomorrow,
        timeRewinds,
        dynamiteCount,
        warehouse,
        dailyShopOffers: prev.dailyShopOffers.map((o) =>
          o.uid === offerUid ? { ...o, sold: true } : o
        ),
      };
    });
  };

  // Nộp cống cuối ngày (phần dư chuyển thành xu)
  const selectedTributeTotal = useMemo(() => {
    const uidSet = new Set(selectedTributeUids);
    return game.warehouse
      .filter((i) => uidSet.has(i.uid) && isItemEligibleForTodayTribute(i, game.day))
      .reduce((sum, i) => sum + i.value, 0);
  }, [game.warehouse, selectedTributeUids, game.day]);

  const surplusTributeCoins = Math.max(
    0,
    Math.round((selectedTributeTotal - tributeRequired) * GAME_CONFIG.SURPLUS_TO_COINS_RATE)
  );

  const handleToggleTributeUid = (uid: string) => {
    setSelectedTributeUids((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
    );
  };

  const advanceToDay = (nextDay: number, remainingWarehouse: GameItem[], bonusCoins: number, endless = false) => {
    const passiveCoins = computeShowcaseIncome(game.showcase);
    const totalAddedCoins = passiveCoins + bonusCoins;
    const merchantOpens = isMerchantDay(nextDay);
    audioRef.current?.playOutcome('gem');

    safeDigStreakRef.current = 0;
    setGame((prev) => ({
      ...prev,
      day: nextDay,
      endlessMode: endless || prev.endlessMode,
      phase: 'MINING',
      workshopTab: 'warehouse',
      coins: prev.coins + totalAddedCoins,
      baseShovels: GAME_CONFIG.START_SHOVELS + prev.extraShovelsTomorrow,
      extraShovelsTomorrow: 0,
      shovelsUsed: 0,
      hasMapForToday: prev.hasMapForTomorrow,
      hasMapForTomorrow: false,
      bonusStartShieldToday: prev.bonusStartShieldTomorrow ?? 0,
      bonusStartShieldTomorrow: 0,
      luckyDayToday: Boolean(prev.luckyDayTomorrow),
      luckyDayTomorrow: false,
      superLampToday: Boolean(prev.superLampTomorrow),
      superLampTomorrow: false,
      inShaft: false,
      depth: 0,
      shieldPoints: 0,
      safeDigStreak: 0,
      bag: [],
      warehouse: remainingWarehouse.map((i) => ({
        ...i,
        keepForTribute: false,
        notForTribute: true,
        nonTributeReason: i.nonTributeReason ?? 'old_day',
      })),
      market: generateDailyMarket(),
      merchantOffers: generateMerchantOffers(nextDay),
      dailyShopOffers: generateDailyShopOffers(nextDay),
      visitor: generateVisitorOrder(nextDay),
      lastFoundItem: null,
      lastOutcomeText: [
        `Ngày ${nextDay} bắt đầu!`,
        bonusCoins > 0 ? `Phần dư cống +${bonusCoins} xu.` : '',
        passiveCoins > 0 ? `Tủ kính +${passiveCoins} xu.` : '',
        merchantOpens ? 'Phiên chợ Thương Nhân đã mở ở Xưởng!' : '',
      ]
        .filter(Boolean)
        .join(' '),
      stats: {
        ...prev.stats,
        totalCoinsEarned: prev.stats.totalCoinsEarned + totalAddedCoins,
      },
    }));
  };

  const handleSubmitTribute = () => {
    ensureAudioUnlocked();
    if (selectedTributeTotal < tributeRequired) {
      // Không đủ cống -> Thua cuộc
      audioRef.current?.playOutcome('collapse');
      vibrateDevice([150, 80, 200]);
      setGame((prev) => ({ ...prev, phase: 'DEFEAT' }));
      return;
    }

    const uidSet = new Set(selectedTributeUids);
    const remainingWarehouse = game.warehouse.filter((i) => !uidSet.has(i.uid));

    // Hoàn thành chiến dịch 14 ngày (nếu chưa ở chế độ Vô tận)
    if (!game.endlessMode && game.day >= GAME_CONFIG.CAMPAIGN_DAYS) {
      audioRef.current?.playOutcome('relic');
      setGame((prev) => ({
        ...prev,
        coins: prev.coins + surplusTributeCoins,
        warehouse: remainingWarehouse,
        phase: 'VICTORY',
        stats: {
          ...prev.stats,
          totalCoinsEarned: prev.stats.totalCoinsEarned + surplusTributeCoins,
        },
      }));
      return;
    }

    advanceToDay(game.day + 1, remainingWarehouse, surplusTributeCoins, Boolean(game.endlessMode));
  };

  const handleContinueEndless = () => {
    ensureAudioUnlocked();
    advanceToDay(game.day + 1, game.warehouse, 0, true);
  };

  // ============================================================================
  // 8. CÁC THÀNH PHẦN GIAO DIỆN PHỤ TRỢ
  // ============================================================================
  const allShovelsSpent = !game.inShaft && game.shovelsUsed >= totalShovelsToday;
  const gemsInWarehouse = game.warehouse.filter((i) => i.category === 'gem');
  const passiveIncomePreview = computeShowcaseIncome(game.showcase);

  // Tách bạch rõ ràng: (1) Đồ kiếm được trong hôm nay để nộp cống vs (2) Tổng giá trị Ngọc & đồ tồn không cống được
  const todayEarnedWarehouseTotal = game.warehouse
    .filter((i) => isItemEligibleForTodayTribute(i, game.day))
    .reduce((s, i) => s + i.value, 0);
  const keptTodayTributeTotal = game.warehouse
    .filter((i) => isItemEligibleForTodayTribute(i, game.day) && i.keepForTribute !== false)
    .reduce((s, i) => s + i.value, 0);
  const nonTributeWarehouseTotal = game.warehouse
    .filter((i) => !isItemEligibleForTodayTribute(i, game.day))
    .reduce((s, i) => s + i.value, 0);
  const inBagValueTotal = game.bag.reduce((s, i) => s + i.value, 0);

  const inlaidGemEntries = (['shovel', 'helmet', 'prop'] as EquipSlotId[]).flatMap((slot) =>
    game.equipment[slot]
      .map((gem, socketIdx) => (gem ? { slot, socketIdx, gem } : null))
      .filter((entry): entry is { slot: EquipSlotId; socketIdx: number; gem: GameItem } => entry !== null)
  );
  const warehouseGemsValue = gemsInWarehouse.reduce((s, i) => s + i.value, 0);
  const inlaidGemsValue = inlaidGemEntries.reduce((s, e) => s + e.gem.value, 0);
  const showcaseGemsValue = game.showcase
    .filter((i) => i.category === 'gem')
    .reduce((s, i) => s + i.value, 0);
  const totalOwnedGemsValue = warehouseGemsValue + inlaidGemsValue + showcaseGemsValue;
  const totalWarehouseTributeCapacity = todayEarnedWarehouseTotal;

  const inspectedShowcaseItem = showcaseInspectUid
    ? game.showcase.find((i) => i.uid === showcaseInspectUid) ?? null
    : null;

  // Bảng thông tin tóm tắt dùng lại ở cột phải trên máy tính bảng & desktop (>= md)
  const DesktopSideLedger = (
    <aside className="hidden md:flex flex-col gap-3 lg:gap-4 w-[280px] lg:w-[360px] xl:w-[400px] h-[min(844px,calc(100dvh-40px))] shrink-0 overflow-y-auto pr-0.5">
      <div className="rounded-2xl bg-[#18110c] border border-amber-700/25 p-4 lg:p-5">
        <div className="flex items-center justify-between border-b border-amber-800/25 pb-3 mb-4">
          <h2 className="font-display text-base lg:text-lg font-bold text-amber-200 tracking-wide">
            Sổ Tay Thợ Mỏ
          </h2>
          <span className="text-xs text-stone-400 tabular-nums">
            {game.endlessMode
              ? `Ngày ${game.day} · Vô tận`
              : `Ngày ${game.day}/${GAME_CONFIG.CAMPAIGN_DAYS}`}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2.5 text-sm">
          <div className="rounded-xl bg-[#110c08] border border-stone-800 p-3">
            <div className="text-[11px] text-stone-400">Mức cống hôm nay</div>
            <div className="text-xl font-bold text-amber-300 tabular-nums mt-0.5">
              {tributeRequired}
            </div>
          </div>
          <div className="rounded-xl bg-[#110c08] border border-emerald-800/40 p-3">
            <div className="text-[11px] text-emerald-300/85">Kiếm hôm nay (Cống)</div>
            <div
              className={`text-xl font-bold tabular-nums mt-0.5 ${
                todayEarnedWarehouseTotal >= tributeRequired
                  ? 'text-emerald-300'
                  : 'text-stone-100'
              }`}
            >
              {todayEarnedWarehouseTotal}
            </div>
            {game.inShaft && inBagValueTotal > 0 && (
              <div className="text-[10px] text-amber-300/90 tabular-nums mt-0.5">
                +{inBagValueTotal} đang trong túi
              </div>
            )}
          </div>
          <div className="col-span-2 rounded-xl bg-[#110c08] border border-purple-700/30 p-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] text-purple-200/90">Tổng giá trị Ngọc đang có</div>
              <div className="text-[10px] text-stone-400 tabular-nums mt-0.5">
                Kho {warehouseGemsValue} · Đang khảm {inlaidGemsValue} · Tủ {showcaseGemsValue}
              </div>
            </div>
            <div className="text-lg font-bold text-purple-300 tabular-nums shrink-0">
              {totalOwnedGemsValue}
            </div>
          </div>
          {nonTributeWarehouseTotal > 0 && (
            <div className="col-span-2 rounded-xl bg-[#110c08] border border-stone-800/80 px-3 py-2 flex items-center justify-between text-xs">
              <span className="text-stone-400">Đồ tồn / không nộp cống được:</span>
              <span className="font-bold text-stone-300 tabular-nums">
                {nonTributeWarehouseTotal}
              </span>
            </div>
          )}
        </div>

        <div className="mt-4 pt-3 border-t border-amber-900/25">
          <div className="text-xs text-stone-400 mb-2">Trang bị & Lỗ khảm</div>
          <div className="grid grid-cols-3 gap-2">
            {(['shovel', 'helmet', 'prop'] as EquipSlotId[]).map((slot) => (
              <div
                key={slot}
                className="rounded-xl bg-[#110c08] border border-stone-800/90 p-2 flex flex-col items-center"
              >
                <div className="scale-75 -my-2">
                  <EquipmentSvg slot={slot} sockets={game.equipment[slot]} />
                </div>
                <span className="text-[11px] text-amber-100/80 text-center truncate w-full">
                  {EQUIPMENT_META[slot].name.split(' ')[0]}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-[#18110c] border border-amber-700/25 p-4 lg:p-5 flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display text-sm lg:text-base font-bold text-amber-200">
            Tủ Kính ({game.showcase.length}/{game.showcaseSlots})
          </h3>
          <span className="text-xs text-amber-300/90 tabular-nums">
            +{passiveIncomePreview} xu/ngày
          </span>
        </div>
        {game.showcase.length === 0 ? (
          <p className="text-xs text-stone-400 leading-relaxed">
            Chưa có vật phẩm trưng bày. Đặt di vật hoặc ngọc quý vào Tủ Kính ở Xưởng để nhận 5%
            thu nhập xu mỗi ngày và kích hoạt thưởng bộ.
          </p>
        ) : (
          <div className="grid grid-cols-3 lg:grid-cols-4 gap-2">
            {game.showcase.map((item) => (
              <div
                key={item.uid}
                className={`rounded-xl bg-[#110c08] border p-2 flex flex-col items-center ${RARITY_INFO[item.rarity].border}`}
                title={`${item.name} (${RARITY_INFO[item.rarity].label})`}
              >
                <ItemSvg templateId={item.templateId} color={item.color} size={30} />
                <span className="text-[10px] text-stone-300 truncate w-full text-center mt-1">
                  {item.name}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 pt-3 border-t border-amber-900/25 space-y-1.5">
          {(Object.keys(RELIC_SETS) as RelicSetId[]).map((setId) => {
            const count = RELIC_SETS[setId].pieces.filter(
              (pid) =>
                game.collectionRecord.includes(pid) ||
                game.showcase.some((s) => s.templateId === pid)
            ).length;
            const done = count === 4;
            return (
              <div key={setId} className="flex items-center justify-between text-xs">
                <span className={done ? 'text-amber-300 font-semibold' : 'text-stone-400'}>
                  {RELIC_SETS[setId].name}
                </span>
                <span className={`tabular-nums ${done ? 'text-emerald-300' : 'text-stone-500'}`}>
                  {count}/4
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );

  // ============================================================================
  // 9. RENDER CHÍNH (Responsive: Điện thoại dọc/ngang, Tablet, Desktop)
  // ============================================================================
  return (
    <div className="min-h-[100dvh] w-full bg-[#0b0705] text-[#f3e7d3] flex items-center justify-center sm:p-3 md:p-5 lg:p-6">
      <div className="w-full max-w-[1060px] flex items-stretch justify-center md:gap-4 lg:gap-6">
        {/* KHUNG CHÍNH (Tràn viền trên điện thoại, bo góc vừa vặn trên tablet/desktop) */}
        <main className="relative w-full sm:max-w-[500px] md:flex-1 md:max-w-[460px] h-[100dvh] sm:h-[min(860px,calc(100dvh-24px))] md:h-[min(844px,calc(100dvh-40px))] sm:rounded-[24px] md:rounded-[28px] sm:border sm:border-amber-700/35 sm:shadow-[0_24px_80px_rgba(0,0,0,0.85)] bg-[#120c08] flex flex-col overflow-hidden">
          {/* THANH TRÊN GỌN GÀNG (hỗ trợ tai thỏ safe-area, nút >= 48px) */}
          <header className="shrink-0 pt-safe min-h-[54px] px-3 bg-[#19110b] border-b border-amber-700/25 flex items-center justify-between gap-2 z-20">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-display font-bold text-base text-amber-300 tracking-wide whitespace-nowrap">
                Hầm Sâu
              </span>
              <span className="text-stone-600" aria-hidden="true">
                ·
              </span>
              <span className="text-xs font-medium text-stone-300 tabular-nums whitespace-nowrap">
                {game.endlessMode
                  ? `Ngày ${game.day} · Vô tận`
                  : `Ngày ${game.day}/${GAME_CONFIG.CAMPAIGN_DAYS}`}
              </span>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <div className="px-2 py-1 text-xs font-semibold text-amber-200 tabular-nums whitespace-nowrap">
                {game.coins} xu
              </div>
              <button
                type="button"
                onClick={handleToggleMute}
                aria-label={muted ? 'Bật âm thanh' : 'Tắt âm thanh'}
                className="min-w-[48px] min-h-[48px] flex items-center justify-center rounded-xl text-amber-200/85 hover:bg-amber-900/30 active:scale-95 transition"
              >
                {muted ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 5L6 9H2v6h4l5 4V5z" />
                    <line x1="23" y1="9" x2="17" y2="15" />
                    <line x1="17" y1="9" x2="23" y2="15" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 5L6 9H2v6h4l5 4V5z" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                  </svg>
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  ensureAudioUnlocked();
                  setShowRules(true);
                }}
                aria-label="Luật chơi và cài đặt"
                className="min-w-[48px] min-h-[48px] flex items-center justify-center rounded-xl text-amber-200/85 hover:bg-amber-900/30 active:scale-95 transition"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </button>
            </div>
          </header>

          {/* ============================================================== */}
          {/* MÀN HÌNH GIỚI THIỆU (INTRO) */}
          {/* ============================================================== */}
          {game.phase === 'INTRO' && (
            <section className="flex-1 flex flex-col justify-between p-5 bg-[radial-gradient(circle_at_50%_20%,rgba(232,155,60,0.16),transparent_65%)] animate-phase overflow-y-auto">
              <div className="mt-4 space-y-5">
                <div className="mx-auto w-24 h-24 rounded-full bg-[#22160d] border border-amber-500/40 flex items-center justify-center shadow-[0_0_40px_rgba(245,158,11,0.25)]">
                  <svg width="56" height="56" viewBox="0 0 64 64" fill="none" aria-hidden="true">
                    <path d="M22 44H42L39 54H25L22 44Z" fill="#8a5a2b" stroke="#eab308" strokeWidth="2" />
                    <path d="M24 22C24 17 28 14 32 14C36 14 40 17 40 22V44H24V22Z" fill="#fbbf24" fillOpacity="0.22" stroke="#f59e0b" strokeWidth="2" />
                    <path d="M32 23C34.5 27 35.5 31 32 34C28.5 31 29.5 27 32 23Z" fill="#fde047" />
                    <path d="M20 14H44" stroke="#d97706" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                </div>

                <div className="text-center space-y-2">
                  <h1 className="font-display text-3xl font-extrabold text-amber-200 tracking-wide">
                    Hầm Sâu
                  </h1>
                  <p className="text-sm text-stone-300 leading-relaxed max-w-xs mx-auto">
                    Bạn mắc nợ Chủ Mỏ. Trong {GAME_CONFIG.CAMPAIGN_DAYS} ngày (và chế độ Vô tận),
                    mỗi ngày phải đào đủ giá trị đồ để nộp cống.
                  </p>
                </div>

                <div className="rounded-2xl bg-[#1a120c] border border-amber-800/30 p-4 space-y-3 text-sm text-stone-300">
                  <div className="flex items-start gap-3">
                    <span className="font-display font-bold text-amber-400 tabular-nums">01.</span>
                    <p>
                      <strong className="text-amber-100">Đào sâu &amp; 2s Vô Hạn:</strong> Xuống càng
                      sâu đồ càng đắt. Đào 10 nhát liên tiếp không sập sẽ kích hoạt 2 giây đào vô
                      hạn!
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="font-display font-bold text-amber-400 tabular-nums">02.</span>
                    <p>
                      <strong className="text-amber-100">Khảm ngọc tăng sức chứa:</strong> Khảm ngọc
                      vào trang bị giúp tăng ô túi mang về và săn ngọc quý ở phiên chợ mỗi 3 ngày.
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="font-display font-bold text-amber-400 tabular-nums">03.</span>
                    <p>
                      <strong className="text-amber-100">Phần dư đổi xu:</strong> Nộp cống vượt mức
                      sẽ đổi thành xu để nâng cấp lỗ khảm, mua ngọc và vượt qua {GAME_CONFIG.CAMPAIGN_DAYS} ngày!
                    </p>
                  </div>
                </div>
              </div>

              <div className="pt-4 pb-2">
                <button
                  type="button"
                  onClick={handleStartFromIntro}
                  className="w-full min-h-[56px] rounded-2xl bg-gradient-to-b from-amber-500 to-amber-700 text-[#180f07] font-display font-extrabold text-lg tracking-wide shadow-[0_8px_28px_rgba(245,158,11,0.35)] active:scale-[0.98] transition"
                >
                  Cầm Xẻng Xuống Hầm
                </button>
              </div>
            </section>
          )}

          {/* ============================================================== */}
          {/* GIAI ĐOẠN 1: ĐÀO (MINING) */}
          {/* ============================================================== */}
          {game.phase === 'MINING' && (
            <section className="flex-1 flex flex-col min-h-0 overflow-y-auto animate-phase">
              {/* Dải thông số chuyến đào */}
              <div className="shrink-0 px-3 py-2 bg-[#160f0a] border-b border-amber-900/30 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  {/* Xẻng hiển thị bằng icon 🪏 */}
                  <div className="flex items-center flex-wrap gap-1.5" aria-label="Số xẻng hôm nay">
                    {Array.from({ length: totalShovelsToday }).map((_, idx) => (
                      <ShovelStatusIcon key={idx} index={idx} used={idx < game.shovelsUsed} />
                    ))}
                  </div>

                  <div className="text-right shrink-0">
                    <div className="text-[10px] text-stone-400">Kiếm hôm nay (Cống)</div>
                    <div
                      className={`text-xs sm:text-sm font-bold tabular-nums ${
                        totalWarehouseTributeCapacity >= tributeRequired
                          ? 'text-emerald-300'
                          : 'text-amber-300'
                      }`}
                    >
                      {totalWarehouseTributeCapacity} / {tributeRequired}
                    </div>
                    {(inBagValueTotal > 0 || totalOwnedGemsValue > 0) && (
                      <div className="text-[10px] text-stone-400 tabular-nums">
                        {inBagValueTotal > 0 ? `Túi +${inBagValueTotal}` : ''}
                        {inBagValueTotal > 0 && totalOwnedGemsValue > 0 ? ' · ' : ''}
                        {totalOwnedGemsValue > 0 ? `Ngọc ${totalOwnedGemsValue}` : ''}
                      </div>
                    )}
                  </div>
                </div>

                {/* Thanh chỉ số độ sâu · nguy cơ · khiên · túi */}
                <div className="grid grid-cols-4 gap-1.5 text-center">
                  <div className="rounded-lg bg-[#1d140e] border border-stone-800/80 py-1.5 px-1">
                    <div className="text-[10px] text-stone-400">Độ sâu</div>
                    <div className="text-sm font-bold text-amber-100 tabular-nums">
                      {game.depth} m
                    </div>
                  </div>
                  <div
                    className={`rounded-lg border py-1.5 px-1 ${
                      currentRisk >= 35
                        ? 'bg-red-950/55 border-red-500/50'
                        : currentRisk >= 22
                          ? 'bg-amber-950/50 border-amber-600/45'
                          : 'bg-[#1d140e] border-stone-800/80'
                    }`}
                  >
                    <div className="text-[10px] text-stone-400">Nguy cơ sập</div>
                    <div
                      className={`text-sm font-bold tabular-nums ${
                        currentRisk >= 35
                          ? 'text-red-300'
                          : currentRisk >= 22
                            ? 'text-amber-300'
                            : 'text-emerald-300'
                      }`}
                    >
                      {currentRisk}%
                    </div>
                  </div>
                  <div className="rounded-lg bg-[#1d140e] border border-stone-800/80 py-1.5 px-1">
                    <div className="text-[10px] text-stone-400">Khiên</div>
                    <div
                      className={`text-sm font-bold tabular-nums ${
                        game.shieldPoints >= GAME_CONFIG.SHIELD_THRESHOLD
                          ? 'text-yellow-300'
                          : 'text-stone-200'
                      }`}
                    >
                      {game.shieldPoints}/{GAME_CONFIG.SHIELD_THRESHOLD}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      ensureAudioUnlocked();
                      setShowBagDrawer(true);
                    }}
                    className={`rounded-lg border py-1.5 px-1 active:scale-95 transition ${
                      game.bag.length >= maxBagSlots
                        ? 'bg-amber-900/45 border-amber-400/70'
                        : 'bg-[#1d140e] border-stone-800/80'
                    }`}
                  >
                    <div className="text-[10px] text-stone-400">Túi đào</div>
                    <div className="text-sm font-bold text-amber-200 tabular-nums">
                      {game.bag.length}/{maxBagSlots}
                    </div>
                  </button>
                </div>

                {/* Thanh chuỗi 10 lần không sập / Đếm ngược 2s Đào Vô Hạn */}
                {isFrenzyActive ? (
                  <div className="rounded-xl bg-amber-950/75 border border-amber-400 px-3 py-1.5 animate-frenzy">
                    <div className="flex items-center justify-between text-xs font-bold text-amber-200">
                      <span>⚡ ĐÀO VÔ HẠN! Bấm liên tục — 0% sập</span>
                      <span className="tabular-nums text-amber-300">
                        {(frenzyRemainingMs / 1000).toFixed(1)}s
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-[#0d0906] overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-amber-300 via-yellow-300 to-amber-500 transition-[width] duration-75"
                        style={{
                          width: `${clamp(
                            (frenzyRemainingMs / GAME_CONFIG.FRENZY_DURATION_MS) * 100,
                            0,
                            100
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-0.5">
                    <span className="text-[10px] text-stone-400 whitespace-nowrap">
                      Chuỗi vô hạn:
                    </span>
                    <div className="flex-1 grid grid-cols-10 gap-1">
                      {Array.from({ length: GAME_CONFIG.FRENZY_STREAK_REQUIRED }).map((_, idx) => (
                        <div
                          key={idx}
                          className={`h-1.5 rounded-full transition-colors ${
                            idx < game.safeDigStreak
                              ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.7)]'
                              : 'bg-stone-800'
                          }`}
                        />
                      ))}
                    </div>
                    <span className="text-[10px] font-bold text-amber-300 tabular-nums">
                      {game.safeDigStreak}/{GAME_CONFIG.FRENZY_STREAK_REQUIRED}
                    </span>
                  </div>
                )}
              </div>

              {/* CỬA SỔ MẶT CẮT HẦM MỎ + PARALLAX + ĐÈN DẦU + HẠT CANVAS + XẺNG ĐÀO */}
              <div
                className={`relative flex-1 min-h-[168px] overflow-hidden select-none ${
                  isFrenzyActive ? 'ring-2 ring-inset ring-amber-400/80' : ''
                } ${
                  shakeMode === 'heavy'
                    ? 'animate-shake-heavy'
                    : shakeMode === 'light'
                      ? 'animate-shake-light'
                      : ''
                }`}
                style={{
                  background: `linear-gradient(180deg, ${currentStratum.bgTop} 0%, ${currentStratum.bgBottom} 100%)`,
                }}
              >
                {/* Họa tiết lớp đất địa chất dịch chuyển theo độ sâu (parallax nhẹ) */}
                <svg
                  className="absolute inset-0 w-full h-full pointer-events-none opacity-85 transition-transform duration-300"
                  viewBox="0 0 400 420"
                  preserveAspectRatio="none"
                  style={{
                    transform: `translate3d(0, ${-((game.depth * 18) % 64)}px, 0)`,
                  }}
                >
                  {/* Tường đá hai bên đường hầm */}
                  <path
                    d="M0 0H86L72 70L92 140L74 210L95 280L78 350L90 420H0V0Z"
                    fill={currentStratum.rockFill}
                  />
                  <path
                    d="M400 0H314L328 70L308 140L326 210L305 280L322 350L310 420H400V0Z"
                    fill={currentStratum.rockFill}
                  />
                  {/* Chi tiết địa chất theo tầng: rễ cây / thạch nhũ / cột cổ / khe nham thạch */}
                  {currentStratum.id === 'earth' && (
                    <g opacity="0.6">
                      <path d="M22 0C26 28 52 38 70 55M378 0C372 34 346 42 330 64" stroke="#7c5233" strokeWidth="3.5" strokeLinecap="round" fill="none" />
                      <circle cx="52" cy="185" r="4" fill="#d97736" />
                      <circle cx="348" cy="240" r="3.5" fill="#fbbf24" />
                    </g>
                  )}
                  {currentStratum.id === 'cavern' && (
                    <g opacity="0.72">
                      <polygon points="96,0 112,0 104,34" fill="#1e3a44" />
                      <polygon points="288,0 306,0 297,42" fill="#1e3a44" />
                      <polygon points="48,140 62,130 56,154" fill="#38bdf8" fillOpacity="0.65" />
                      <polygon points="348,255 332,245 338,272" fill="#67e8f9" fillOpacity="0.65" />
                    </g>
                  )}
                  {currentStratum.id === 'ruins' && (
                    <g opacity="0.68">
                      <rect x="34" y="98" width="24" height="8" rx="2" fill="#eab308" fillOpacity="0.4" />
                      <rect x="342" y="212" width="24" height="8" rx="2" fill="#eab308" fillOpacity="0.4" />
                      <circle cx="46" cy="276" r="7" stroke="#fbbf24" strokeOpacity="0.45" strokeWidth="2" />
                      <circle cx="352" cy="138" r="7" stroke="#fbbf24" strokeOpacity="0.45" strokeWidth="2" />
                    </g>
                  )}
                  {currentStratum.id === 'volcano' && (
                    <g opacity="0.82">
                      <path d="M18 85L56 112L38 148M384 182L340 205L360 245" stroke="#fb7185" strokeWidth="3" strokeLinecap="round" />
                      <path d="M24 275L64 295" stroke="#f97316" strokeWidth="3.5" strokeLinecap="round" />
                    </g>
                  )}
                  {/* Mạch khoáng / tinh thể phát sáng theo tầng */}
                  <path
                    d="M36 90L58 106L44 128M355 150L332 168L348 190M42 260L68 278L50 302M358 310L334 328"
                    stroke={currentStratum.veinColor}
                    strokeWidth="2.4"
                    strokeOpacity="0.45"
                    strokeLinecap="round"
                  />
                  {/* Thanh gỗ chống vòm hầm lặp lại */}
                  {[40, 165, 290, 415].map((yPos) => (
                    <g key={yPos} opacity="0.65">
                      <rect x="78" y={yPos} width="12" height="90" fill="#4f331c" />
                      <rect x="310" y={yPos} width="12" height="90" fill="#4f331c" />
                      <rect x="74" y={yPos} width="252" height="11" rx="2" fill="#634022" />
                    </g>
                  ))}
                </svg>

                {/* Ánh đèn dầu chập chờn + đốm lửa/bụi bay sinh động */}
                <div
                  className="absolute inset-0 pointer-events-none animate-lamp"
                  style={{
                    background: `radial-gradient(circle at 50% 48%, rgba(245, 166, 65, ${
                      isFrenzyActive
                        ? 0.44
                        : game.inShaft
                          ? Math.max(0.14, 0.34 - game.depth * 0.008)
                          : 0.25
                    }) 0%, rgba(10, 6, 4, ${Math.min(0.92, 0.58 + game.depth * 0.015)}) 72%)`,
                  }}
                />
                {shaftAlert && (
                  <div
                    aria-hidden="true"
                    className={`absolute inset-0 pointer-events-none transition-opacity duration-300 ${
                      shaftAlert.kind === 'collapse'
                        ? 'bg-red-600/25'
                        : 'bg-amber-400/15'
                    }`}
                  />
                )}
                <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
                  {[
                    { left: '18%', bottom: '18%', delay: '0s', color: currentStratum.veinColor },
                    { left: '34%', bottom: '10%', delay: '1.1s', color: '#fde047' },
                    { left: '66%', bottom: '14%', delay: '2.1s', color: currentStratum.veinColor },
                    { left: '80%', bottom: '24%', delay: '0.6s', color: '#fbbf24' },
                  ].map((mote, i) => (
                    <span
                      key={i}
                      className="absolute w-1.5 h-1.5 rounded-full animate-ember"
                      style={{
                        left: mote.left,
                        bottom: mote.bottom,
                        animationDelay: mote.delay,
                        backgroundColor: mote.color,
                      }}
                    />
                  ))}
                </div>

                {/* Canvas hiệu ứng hạt & chữ bay */}
                <canvas
                  ref={canvasRef}
                  className="absolute inset-0 w-full h-full pointer-events-none z-10"
                />

                {/* Nhãn tầng địa chất & lời tiên tri Thạch anh tím */}
                <div className="relative z-10 p-3 flex items-center justify-between gap-2">
                  <div className="text-xs text-amber-200/90 font-medium flex items-center gap-1.5 flex-wrap">
                    <span>{currentStratum.name}</span>
                    {game.hasMapForToday && <span className="text-stone-400">· Bản đồ</span>}
                    {game.luckyDayToday && <span className="text-emerald-300">· 🧭 May mắn</span>}
                    {game.superLampToday && <span className="text-amber-300">· 🏮 Đèn lớn</span>}
                    {(game.timeRewinds ?? 0) > 0 && (
                      <span className="text-sky-300">· ⏳x{game.timeRewinds}</span>
                    )}
                  </div>
                  {effectiveBonuses.foresightEnabled && game.inShaft && nextLayerHint && (
                    <div className="text-xs text-purple-300 font-medium shrink-0">
                      Tầng sau:{' '}
                      {nextLayerHint === 'ore'
                        ? 'Quặng'
                        : nextLayerHint === 'gem'
                          ? 'Ngọc quý'
                          : 'Di vật'}
                    </div>
                  )}
                </div>

                {/* Trung tâm hầm: Xẻng xúc đất hoạt ảnh + Mô đất + Vật phẩm vừa đào / Cảnh báo sập */}
                <div className="relative z-10 px-4 pt-1 pb-3 flex flex-col items-center justify-center min-h-[168px]">
                  {/* Hoạt ảnh chiếc xẻng xúc xuống ụ đất đá */}
                  {game.inShaft && (
                    <div className="relative flex flex-col items-center justify-center mb-1.5 h-[72px]">
                      {strikeAnimKey > 0 && (
                        <div
                          key={`ring_${strikeAnimKey}`}
                          className={`absolute bottom-1 w-14 h-7 rounded-full border-2 pointer-events-none animate-shockwave ${
                            isFrenzyActive ? 'border-yellow-300' : 'border-amber-400/80'
                          }`}
                        />
                      )}
                      <div
                        key={`shovel_${strikeAnimKey}`}
                        className={`relative z-10 ${strikeAnimKey > 0 ? 'animate-shovel-plunge' : ''}`}
                      >
                        <svg width="54" height="54" viewBox="0 0 64 64" fill="none" aria-hidden="true">
                          <defs>
                            <linearGradient id="digShovelBlade" x1="20" y1="24" x2="44" y2="56" gradientUnits="userSpaceOnUse">
                              <stop offset="0%" stopColor="#fde68a" />
                              <stop offset="45%" stopColor="#d97706" />
                              <stop offset="100%" stopColor="#451a03" />
                            </linearGradient>
                          </defs>
                          <path d="M23 10H41" stroke="#e3b96f" strokeWidth="4.5" strokeLinecap="round" />
                          <rect x="29" y="10" width="6" height="20" rx="2" fill="#8a5a2b" stroke="#c89b54" strokeWidth="1.2" />
                          <path
                            d="M19 28H45L42 46C41 53 32 58 32 58C32 58 23 53 22 46L19 28Z"
                            fill="url(#digShovelBlade)"
                            stroke="#fef3c7"
                            strokeWidth="1.5"
                          />
                          <line x1="32" y1="31" x2="32" y2="50" stroke="#fffbeb" strokeOpacity="0.45" strokeWidth="1.4" />
                        </svg>
                      </div>
                      {/* Mô đất đá chịu lực xúc */}
                      <svg width="88" height="18" viewBox="0 0 88 18" fill="none" className="-mt-2" aria-hidden="true">
                        <ellipse cx="44" cy="12" rx="38" ry="6" fill={currentStratum.rockFill} stroke={currentStratum.veinColor} strokeOpacity="0.4" strokeWidth="1" />
                        <circle cx="28" cy="11" r="2" fill={currentStratum.veinColor} fillOpacity="0.7" />
                        <circle cx="58" cy="12" r="2.2" fill={currentStratum.veinColor} fillOpacity="0.7" />
                      </svg>
                    </div>
                  )}

                  {isDiggingWait ? (
                    <div className="flex flex-col items-center gap-1 text-amber-200">
                      <span className="font-display text-sm tracking-wide">
                        Đang xúc sâu xuống lớp đá...
                      </span>
                    </div>
                  ) : shaftAlert ? (
                    <div
                      className={`w-full max-w-[290px] rounded-2xl border p-3.5 text-center space-y-1.5 animate-alert-pop ${
                        shaftAlert.kind === 'shield'
                          ? 'bg-amber-950/85 border-yellow-400/75 shadow-[0_0_24px_rgba(250,204,21,0.28)]'
                          : 'bg-rose-950/90 border-rose-500/80 shadow-[0_0_26px_rgba(239,68,68,0.35)]'
                      }`}
                    >
                      <div
                        className={`font-display font-extrabold text-sm ${
                          shaftAlert.kind === 'shield' ? 'text-yellow-300' : 'text-rose-200'
                        }`}
                      >
                        {shaftAlert.kind === 'shield'
                          ? '🛡️ SUÝT SẬP HẦM — KHIÊN ĐỠ ĐÒN!'
                          : `💥 SẬP HẦM Ở ĐỘ SÂU ${shaftAlert.depth} m!`}
                      </div>
                      <p className="text-[11px] text-stone-200 leading-relaxed">
                        {game.lastOutcomeText}
                      </p>
                    </div>
                  ) : game.lastFoundItem ? (
                    <button
                      type="button"
                      onClick={() => {
                        ensureAudioUnlocked();
                        if (game.lastFoundItem) setInspectedMiningItem(game.lastFoundItem);
                      }}
                      className={`w-full max-w-[296px] rounded-2xl bg-[#19110b]/92 border p-3 flex items-center gap-3 backdrop-blur-sm text-left active:scale-[0.98] transition ${
                        RARITY_INFO[game.lastFoundItem.rarity].border
                      } ${RARITY_INFO[game.lastFoundItem.rarity].glow}`}
                    >
                      <div className="w-11 h-11 rounded-xl bg-[#100a06] border border-amber-900/40 flex items-center justify-center shrink-0">
                        <ItemSvg
                          templateId={game.lastFoundItem.templateId}
                          color={game.lastFoundItem.color}
                          size={36}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] text-stone-400 flex items-center justify-between gap-1">
                          <span>
                            {RARITY_INFO[game.lastFoundItem.rarity].label} ·{' '}
                            <span className="text-amber-300 font-semibold tabular-nums">
                              {game.lastFoundItem.value} giá trị
                            </span>
                          </span>
                          <span className="text-[10px] text-stone-500">Chạm xem</span>
                        </div>
                        <div className="font-display font-bold text-sm sm:text-base text-amber-100 truncate">
                          {game.lastFoundItem.name}
                        </div>
                        {game.lastFoundItem.category === 'gem' ? (
                          <div className="text-[11px] text-purple-300 truncate mt-0.5">
                            Khảm: {describeGemEffect(game.lastFoundItem.gemKind, game.lastFoundItem.rarity)}
                          </div>
                        ) : game.lastFoundItem.category === 'relic' && game.lastFoundItem.relicSet ? (
                          <div className="text-[11px] text-amber-300/85 truncate mt-0.5">
                            {RELIC_SETS[game.lastFoundItem.relicSet].name}
                          </div>
                        ) : null}
                      </div>
                    </button>
                  ) : (
                    <div className="text-center max-w-[280px] space-y-2">
                      {!game.inShaft && (
                        <div className="mx-auto w-14 h-14 rounded-full bg-amber-900/20 border border-amber-500/30 flex items-center justify-center">
                          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                            <path d="M16 5C18.5 9.5 19.5 13 16 16.5C12.5 13 13.5 9.5 16 5Z" fill="#fde047" />
                            <rect x="11" y="18" width="10" height="8" rx="2" fill="#8a5a2b" stroke="#f59e0b" strokeWidth="1.4" />
                          </svg>
                        </div>
                      )}
                      <p className="text-xs text-stone-300/90 leading-relaxed">
                        {game.lastOutcomeText}
                      </p>
                    </div>
                  )}
                </div>

                {/* Dòng thông báo kết quả dưới đáy hầm */}
                {game.lastFoundItem && !shaftAlert && (
                  <div className="relative z-10 px-4 pb-2 text-center">
                    <p className="text-xs text-stone-200/90 drop-shadow">{game.lastOutcomeText}</p>
                  </div>
                )}
              </div>

              {/* Dải xem nhanh đồ trong túi lượt này (chạm để xem/bỏ 1 món hoặc bấm Bỏ nhiều) */}
              {game.bag.length > 0 && (
                <div className="shrink-0 px-3 py-2 bg-[#160f0a] border-t border-amber-900/25 flex items-center gap-2 overflow-x-auto">
                  <button
                    type="button"
                    onClick={() => {
                      ensureAudioUnlocked();
                      setShowBagDrawer(true);
                    }}
                    className="shrink-0 min-h-[48px] px-2.5 rounded-xl bg-rose-950/45 border border-rose-500/40 text-rose-200 text-[11px] font-semibold flex flex-col items-center justify-center leading-tight active:scale-95 transition"
                  >
                    <span>Bỏ đồ</span>
                    <span className="text-[10px] text-rose-300/80 tabular-nums">
                      {game.bag.length}/{maxBagSlots}
                    </span>
                  </button>
                  {game.bag.map((item) => (
                    <button
                      key={item.uid}
                      type="button"
                      onClick={() => {
                        ensureAudioUnlocked();
                        setInspectedMiningItem(item);
                      }}
                      className={`shrink-0 min-h-[48px] px-2.5 rounded-xl bg-[#21160f] border flex items-center gap-1.5 active:scale-95 transition ${RARITY_INFO[item.rarity].border}`}
                    >
                      <ItemSvg templateId={item.templateId} color={item.color} size={24} />
                      <div className="text-left leading-tight">
                        <div className="text-xs font-semibold text-amber-100 tabular-nums">
                          {item.value}
                        </div>
                        {item.category === 'gem' && (
                          <div className="text-[9px] text-purple-300">Ngọc</div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* BẢNG ĐIỀU KHIỂN NGÓN CÁI (Dưới cùng - Tối thiểu 56px, có safe-area) */}
              <div className="shrink-0 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] bg-[#19110b] border-t border-amber-700/30 space-y-2">
                {allShovelsSpent ? (
                  <div className="space-y-1.5">
                    <button
                      type="button"
                      onClick={handleGoToWorkshop}
                      className="w-full min-h-[56px] rounded-2xl bg-gradient-to-b from-amber-500 to-amber-700 text-[#180f07] font-display font-extrabold text-sm sm:text-base tracking-wide shadow-[0_6px_24px_rgba(245,158,11,0.3)] active:scale-[0.98] transition px-2"
                    >
                      Hết Xẻng — Vào Xưởng Bán Đồ &amp; Mua Sắm →
                    </button>
                    <p className="text-[11px] text-stone-400 text-center">
                      Mua thêm xẻng &amp; vật phẩm cho ván kế tại Chợ trong Xưởng.
                    </p>
                  </div>
                ) : !game.inShaft ? (
                  <button
                    type="button"
                    onClick={handleEnterShaft}
                    className="w-full min-h-[56px] rounded-2xl bg-gradient-to-b from-amber-500 to-amber-700 text-[#180f07] font-display font-extrabold text-sm sm:text-base tracking-wide shadow-[0_6px_24px_rgba(245,158,11,0.3)] active:scale-[0.98] transition px-2"
                  >
                    {game.hasMapForToday
                      ? `Xuống Hầm (Bắt đầu ${GAME_CONFIG.MAP_START_DEPTH} m)`
                      : 'Xuống Hầm Mới'}
                  </button>
                ) : (
                  <div className="space-y-2">
                    {(game.dynamiteCount ?? 0) > 0 && !isFrenzyActive && (
                      <button
                        type="button"
                        disabled={isDiggingWait}
                        onClick={handleUseDynamite}
                        className="w-full min-h-[48px] rounded-xl bg-orange-950/65 border border-orange-500/55 text-orange-200 font-bold text-xs px-3 disabled:opacity-50 active:scale-[0.98] transition flex items-center justify-between"
                      >
                        <span>💣 Dùng Mìn Phá Đá (+1m · 0% sập · Đồ Hiếm+)</span>
                        <span className="tabular-nums text-amber-300">Còn {game.dynamiteCount}</span>
                      </button>
                    )}
                    <div className="grid grid-cols-5 gap-2.5">
                      <button
                        type="button"
                        disabled={isDiggingWait}
                        onClick={handleAscend}
                        className="col-span-2 min-h-[56px] rounded-2xl bg-[#2a1f16] border border-amber-600/45 text-amber-100 font-semibold text-xs sm:text-sm px-2 disabled:opacity-50 active:scale-[0.97] transition"
                      >
                        LÊN ({game.bag.length} món)
                      </button>
                      <button
                        type="button"
                        disabled={isDiggingWait}
                        onClick={handleDig}
                        className={`col-span-3 min-h-[56px] rounded-2xl font-display font-extrabold text-base sm:text-lg tracking-wide disabled:opacity-60 active:scale-[0.96] transition ${
                          isFrenzyActive
                            ? 'bg-gradient-to-b from-yellow-300 via-amber-400 to-amber-600 text-[#180f07] shadow-[0_0_28px_rgba(251,191,36,0.65)]'
                            : 'bg-gradient-to-b from-amber-500 to-amber-700 text-[#180f07] shadow-[0_6px_24px_rgba(245,158,11,0.32)]'
                        }`}
                      >
                        {isFrenzyActive
                          ? isDiggingWait
                            ? '⚡ Đang xúc...'
                            : '⚡ ĐÀO VÔ HẠN!'
                          : isDiggingWait
                            ? 'Đang đào...'
                            : 'ĐÀO (+1 m)'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ============================================================== */}
          {/* GIAI ĐOẠN 2: XƯỞNG (PHÂN LOẠI / TỦ KÍNH / KHẢM / CHỢ) */}
          {/* ============================================================== */}
          {game.phase === 'WORKSHOP' && (
            <section className="flex-1 flex flex-col min-h-0 animate-phase">
              {/* Thanh chuyển 4 khu vực trong Xưởng */}
              <div className="shrink-0 px-3 pt-2.5 pb-2 bg-[#160f0a] border-b border-amber-900/30">
                <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-[#0e0906] border border-stone-800/80">
                  {(
                    [
                      { id: 'warehouse', label: `Kho (${game.warehouse.length})` },
                      { id: 'showcase', label: `Tủ (${game.showcase.length}/${game.showcaseSlots})` },
                      { id: 'inlay', label: 'Khảm' },
                      { id: 'market', label: merchantActiveToday ? 'Chợ ★' : 'Chợ' },
                    ] as { id: WorkshopTab; label: string }[]
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        ensureAudioUnlocked();
                        setGame((prev) => ({ ...prev, workshopTab: tab.id }));
                      }}
                      className={`min-h-[48px] rounded-lg text-[11px] sm:text-xs font-semibold transition whitespace-nowrap px-1 ${
                        game.workshopTab === tab.id
                          ? 'bg-amber-600/25 text-amber-200 border border-amber-500/45'
                          : 'text-stone-400 hover:text-stone-200'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Nội dung từng tab Xưởng */}
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {/* TAB 1: KHO PHÂN LOẠI */}
                {game.workshopTab === 'warehouse' && (
                  <>
                    {/* Bảng đối chiếu rõ ràng: Giá trị đào hôm nay (Cống được) vs Tổng giá trị Ngọc & đồ tồn */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-xl bg-[#19120c] border border-emerald-700/35 p-2.5">
                        <div className="text-[10px] text-emerald-300/90 font-semibold">
                          Kiếm hôm nay (Cống được)
                        </div>
                        <div className="flex items-baseline justify-between gap-1 mt-0.5">
                          <span
                            className={`text-base font-bold tabular-nums ${
                              keptTodayTributeTotal >= tributeRequired
                                ? 'text-emerald-300'
                                : 'text-amber-300'
                            }`}
                          >
                            {keptTodayTributeTotal}/{tributeRequired}
                          </span>
                          <span className="text-[10px] text-stone-400 tabular-nums">
                            Tổng hôm nay: {todayEarnedWarehouseTotal}
                          </span>
                        </div>
                      </div>
                      <div className="rounded-xl bg-[#19120c] border border-purple-700/35 p-2.5">
                        <div className="text-[10px] text-purple-200/90 font-semibold">
                          Tổng giá trị Ngọc đang có
                        </div>
                        <div className="flex items-baseline justify-between gap-1 mt-0.5">
                          <span className="text-base font-bold text-purple-300 tabular-nums">
                            {totalOwnedGemsValue}
                          </span>
                          <span className="text-[10px] text-stone-400 tabular-nums truncate">
                            Kho {warehouseGemsValue} · Khảm {inlaidGemsValue}
                          </span>
                        </div>
                      </div>
                    </div>
                    {nonTributeWarehouseTotal > 0 && (
                      <div className="px-1 text-[11px] text-stone-400 flex items-center justify-between">
                        <span>Đồ mua / tháo khảm / tồn ngày cũ (không cống):</span>
                        <span className="font-semibold text-stone-300 tabular-nums">
                          {nonTributeWarehouseTotal} giá trị
                        </span>
                      </div>
                    )}

                    {game.warehouse.length === 0 ? (
                      <div className="rounded-2xl bg-[#1a120c] border border-stone-800 p-6 text-center space-y-2">
                        <p className="font-display text-base text-amber-200">Kho đang trống</p>
                        <p className="text-xs text-stone-400">
                          Bạn không còn vật phẩm nào trong kho. Kiểm tra Tủ kính hoặc chuyển sang
                          Nộp cống.
                        </p>
                      </div>
                    ) : (
                      game.warehouse.map((item) => {
                        const sellVal = computeSellPrice(item, game.market);
                        const marketPct = Math.round((game.market[item.category] - 1) * 100);
                        const eligibleForTribute = isItemEligibleForTodayTribute(item, game.day);
                        const kept = eligibleForTribute && item.keepForTribute !== false;
                        const isRecordedRelic =
                          item.category === 'relic' &&
                          game.collectionRecord.includes(item.templateId);

                        return (
                          <div
                            key={item.uid}
                            className={`rounded-2xl bg-[#1b130d] border p-3 space-y-2.5 ${RARITY_INFO[item.rarity].border} ${RARITY_INFO[item.rarity].glow}`}
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-12 h-12 rounded-xl bg-[#110b07] border border-stone-800 flex items-center justify-center shrink-0">
                                <ItemSvg
                                  templateId={item.templateId}
                                  color={item.color}
                                  size={38}
                                />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-display font-bold text-sm text-amber-100 truncate">
                                    {item.name}
                                  </span>
                                  <span
                                    className={`text-sm font-bold tabular-nums shrink-0 ${
                                      eligibleForTribute ? 'text-amber-300' : 'text-stone-400'
                                    }`}
                                  >
                                    {eligibleForTribute
                                      ? `${item.value} cống`
                                      : `${item.value} (Không cống)`}
                                  </span>
                                </div>
                                <div className="text-xs text-stone-400 flex items-center flex-wrap gap-x-1.5">
                                  <span className={RARITY_INFO[item.rarity].text}>
                                    {RARITY_INFO[item.rarity].label}
                                  </span>
                                  <span>·</span>
                                  <span>
                                    Giá bán {sellVal} xu (
                                    {marketPct >= 0 ? `+${marketPct}%` : `${marketPct}%`})
                                  </span>
                                  <span>·</span>
                                  <span
                                    className={
                                      eligibleForTribute
                                        ? 'text-emerald-300 font-medium'
                                        : 'text-stone-400'
                                    }
                                  >
                                    {eligibleForTribute ? 'Đào hôm nay' : 'Không cống'}
                                  </span>
                                </div>
                                <div className="text-[11px] mt-0.5">
                                  {item.category === 'gem' ? (
                                    <span className="text-purple-300">
                                      Ngọc (Khảm được): {describeGemEffect(item.gemKind, item.rarity)}
                                    </span>
                                  ) : item.category === 'relic' ? (
                                    <span className="text-amber-300/85">
                                      Di vật · Không khảm được ·{' '}
                                      {isRecordedRelic
                                        ? 'Đã có trong Bộ sưu tập'
                                        : 'Chưa lưu Bộ sưu tập'}
                                    </span>
                                  ) : (
                                    <span className="text-stone-400">
                                      Quặng · Không khảm được (chỉ nộp cống, bán hoặc trưng bày)
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            {!eligibleForTribute && (
                              <div className="text-[11px] text-amber-300/80">
                                {getNonTributeReasonLabel(item, game.day)}
                              </div>
                            )}

                            {/* Mỗi món chỉ chọn MỘT hành động */}
                            <div className="grid grid-cols-3 gap-1.5">
                              <button
                                type="button"
                                disabled={!eligibleForTribute}
                                onClick={() => handleToggleKeepForTribute(item.uid)}
                                className={`min-h-[48px] rounded-xl text-xs font-semibold border transition px-1.5 disabled:opacity-40 ${
                                  kept
                                    ? 'bg-emerald-950/60 border-emerald-500/60 text-emerald-200'
                                    : 'bg-[#130d09] border-stone-700/70 text-stone-300'
                                }`}
                              >
                                {!eligibleForTribute
                                  ? 'Không cống'
                                  : kept
                                    ? '✓ Giữ cống'
                                    : 'Giữ cống'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSellWarehouseItem(item.uid)}
                                className="min-h-[48px] rounded-xl text-xs font-semibold bg-[#271b11] border border-amber-600/40 text-amber-200 active:scale-95 transition px-1.5"
                              >
                                Bán +{sellVal} xu
                              </button>
                              {item.category === 'gem' ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setGemToInlay(item);
                                    setGame((prev) => ({ ...prev, workshopTab: 'inlay' }));
                                  }}
                                  className="min-h-[48px] rounded-xl text-xs font-semibold bg-purple-950/50 border border-purple-500/45 text-purple-200 active:scale-95 transition px-1.5"
                                >
                                  Khảm ngọc
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={game.showcase.length >= game.showcaseSlots}
                                  onClick={() => handleDisplayItem(item.uid)}
                                  className="min-h-[48px] rounded-xl text-xs font-semibold bg-[#221a14] border border-amber-500/35 text-amber-100 disabled:opacity-40 active:scale-95 transition px-1.5"
                                >
                                  Trưng bày
                                </button>
                              )}
                            </div>

                            {item.category === 'gem' && (
                              <button
                                type="button"
                                disabled={game.showcase.length >= game.showcaseSlots}
                                onClick={() => handleDisplayItem(item.uid)}
                                className="w-full min-h-[48px] rounded-xl text-xs font-medium bg-[#16100b] border border-stone-700/70 text-stone-300 disabled:opacity-40"
                              >
                                Hoặc đặt vào Tủ kính (+{Math.round(item.value * 0.05)} xu/ngày)
                              </button>
                            )}

                            {item.category === 'relic' && !isRecordedRelic && (
                              <button
                                type="button"
                                onClick={() => handleRecordRelic(item.uid, 'warehouse')}
                                className="w-full min-h-[48px] rounded-xl text-xs font-semibold bg-amber-950/55 border border-amber-500/50 text-amber-200 active:scale-[0.98] transition"
                              >
                                Lưu Vào Bộ Sưu Tập (Ghi nhận vĩnh viễn)
                              </button>
                            )}
                          </div>
                        );
                      })
                    )}
                  </>
                )}

                {/* TAB 2: TỦ TRƯNG BÀY & BỘ SƯU TẬP */}
                {game.workshopTab === 'showcase' && (
                  <>
                    {/* Khách tham quan đặt hàng */}
                    {game.visitor && (
                      <div className="rounded-2xl bg-[#1e150e] border border-amber-500/35 p-3.5 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-display text-sm font-bold text-amber-200">
                            {game.visitor.visitorName}
                          </span>
                          <span className="text-xs font-semibold text-amber-300 tabular-nums">
                            Thưởng +{game.visitor.rewardCoins} xu
                          </span>
                        </div>
                        <p className="text-xs text-stone-300">
                          Đang tìm chiêm ngưỡng:{' '}
                          <strong className="text-amber-100">{game.visitor.targetName}</strong>
                        </p>
                        {game.visitor.fulfilled ? (
                          <div className="text-xs text-emerald-300 font-semibold">
                            ✓ Đã hoàn thành đơn khách tham quan hôm nay
                          </div>
                        ) : matchingVisitorShowcaseItem ? (
                          <button
                            type="button"
                            onClick={handleFulfillVisitor}
                            className="w-full min-h-[48px] rounded-xl bg-amber-600 text-[#180f07] font-bold text-xs active:scale-95 transition"
                          >
                            Mời Khách Xem Tủ — Nhận +{game.visitor.rewardCoins} xu
                          </button>
                        ) : (
                          <div className="text-[11px] text-stone-400">
                            Đặt {game.visitor.targetName} lên Tủ kính để nhận thưởng xu.
                          </div>
                        )}
                      </div>
                    )}

                    {/* Tủ kính có đèn rọi — chạm vào vật phẩm để Lấy ra hoặc Bán */}
                    <div className="rounded-2xl bg-[linear-gradient(180deg,#251a12_0%,#140e09_100%)] border-2 border-amber-700/45 p-3.5 relative overflow-hidden">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-display text-sm font-bold text-amber-200">
                          Tủ Kính ({game.showcase.length}/{game.showcaseSlots} ô)
                        </span>
                        <span className="text-xs text-emerald-300 font-semibold tabular-nums">
                          +{passiveIncomePreview} xu/ngày (5%)
                        </span>
                      </div>
                      <p className="text-[11px] text-stone-400 mb-3">
                        Chạm vào món trên tủ để lấy ra Kho, bán xu hoặc lưu Bộ sưu tập.
                      </p>

                      <div className="grid grid-cols-3 min-[380px]:grid-cols-4 gap-2">
                        {Array.from({ length: game.showcaseSlots }).map((_, idx) => {
                          const item = game.showcase[idx];
                          if (!item) {
                            return (
                              <div
                                key={idx}
                                className="relative rounded-xl min-h-[86px] p-1.5 flex flex-col items-center justify-center border bg-[#0e0906]/80 border-stone-800/80 border-dashed overflow-hidden"
                              >
                                <span className="text-[10px] text-stone-600">Trống</span>
                              </div>
                            );
                          }
                          return (
                            <button
                              key={item.uid}
                              type="button"
                              onClick={() => {
                                ensureAudioUnlocked();
                                setShowcaseInspectUid(item.uid);
                              }}
                              className={`relative rounded-xl min-h-[86px] p-1.5 flex flex-col items-center justify-center border overflow-hidden active:scale-95 transition bg-[#120d09] ${RARITY_INFO[item.rarity].border} ${RARITY_INFO[item.rarity].glow}`}
                            >
                              {/* Ánh đèn rọi từ nóc tủ */}
                              <div
                                aria-hidden="true"
                                className="absolute -top-2 inset-x-1 h-8 pointer-events-none"
                                style={{
                                  background: `radial-gradient(ellipse at top, ${RARITY_INFO[item.rarity].hex}38, transparent 70%)`,
                                }}
                              />
                              <ItemSvg
                                templateId={item.templateId}
                                color={item.color}
                                size={32}
                              />
                              <span className="text-[10px] text-amber-100 text-center leading-tight line-clamp-2 mt-1">
                                {item.name}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Sổ Bộ Sưu Tập Di Vật (Lưu vĩnh viễn từng mảnh) */}
                    <div className="rounded-2xl bg-[#1a120c] border border-stone-800 p-3.5 space-y-3">
                      <div>
                        <h3 className="font-display text-sm font-bold text-amber-200">
                          Sổ Bộ Sưu Tập Di Vật (Lưu Vĩnh Viễn)
                        </h3>
                        <p className="text-[11px] text-stone-400 mt-0.5">
                          Cống di vật vào Bộ sưu tập để ghi nhận vĩnh viễn và giữ ô trống cho Tủ
                          kính. Đủ 4 mảnh sẽ kích hoạt thưởng bộ.
                        </p>
                      </div>
                      {(Object.keys(RELIC_SETS) as RelicSetId[]).map((setId) => {
                        const setInfo = RELIC_SETS[setId];
                        const ownedCount = setInfo.pieces.filter(
                          (pid) =>
                            game.collectionRecord.includes(pid) ||
                            game.showcase.some((s) => s.templateId === pid)
                        ).length;
                        const active = ownedCount === 4;

                        return (
                          <div
                            key={setId}
                            className={`rounded-xl p-3 border space-y-2.5 ${
                              active
                                ? 'bg-amber-950/35 border-amber-500/50'
                                : 'bg-[#120c08] border-stone-800/80'
                            }`}
                          >
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-amber-100">{setInfo.name}</span>
                              <span
                                className={`tabular-nums font-bold ${
                                  active ? 'text-emerald-300' : 'text-stone-400'
                                }`}
                              >
                                {ownedCount}/4
                              </span>
                            </div>
                            <div className="text-[11px] text-stone-400">{setInfo.bonusLabel}</div>

                            <div className="grid grid-cols-2 gap-1.5">
                              {setInfo.pieces.map((pid) => {
                                const tpl = ITEM_TEMPLATES.find((t) => t.id === pid);
                                if (!tpl) return null;
                                const isRecorded = game.collectionRecord.includes(pid);
                                const inShowcase = game.showcase.find((s) => s.templateId === pid);
                                const inWarehouse = game.warehouse.find((w) => w.templateId === pid);
                                const canDonate = !isRecorded && (inWarehouse || inShowcase);

                                return (
                                  <div
                                    key={pid}
                                    className={`rounded-xl border p-2 flex items-center gap-2 ${
                                      isRecorded
                                        ? 'bg-emerald-950/25 border-emerald-500/45'
                                        : inShowcase
                                          ? 'bg-amber-950/25 border-amber-500/40'
                                          : 'bg-[#0d0906] border-stone-800/80'
                                    }`}
                                  >
                                    <div className={isRecorded || inShowcase ? '' : 'opacity-35 grayscale'}>
                                      <ItemSvg templateId={tpl.id} color={tpl.color} size={26} />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="text-[11px] font-medium text-amber-100 truncate">
                                        {tpl.name}
                                      </div>
                                      {isRecorded ? (
                                        <div className="text-[10px] text-emerald-300">
                                          ✓ Đã ghi nhận
                                        </div>
                                      ) : canDonate ? (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            inWarehouse
                                              ? handleRecordRelic(inWarehouse.uid, 'warehouse')
                                              : inShowcase &&
                                                handleRecordRelic(inShowcase.uid, 'showcase')
                                          }
                                          className="mt-1 min-h-[36px] w-full rounded-lg bg-amber-600 text-[#180f07] font-bold text-[10px] px-1.5 active:scale-95 transition"
                                        >
                                          Lưu vào sổ
                                        </button>
                                      ) : (
                                        <div className="text-[10px] text-stone-500">Chưa có</div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

                {/* TAB 3: KHẢM NGỌC VÀO TRANG BỊ */}
                {game.workshopTab === 'inlay' && (
                  <>
                    {/* Giải thích rõ món nào khảm được & phân biệt ngọc đang khảm (làm mờ) */}
                    <div className="rounded-2xl bg-[#1a120c] border border-purple-500/35 p-3 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-display text-xs font-bold text-purple-200">
                          Quy Tắc Khảm: Chỉ có NGỌC mới khảm được
                        </span>
                        <span className="text-[11px] font-bold text-amber-300 tabular-nums">
                          Túi: {maxBagSlots} ô
                        </span>
                      </div>
                      <p className="text-[11px] text-stone-300 leading-relaxed">
                        Chỉ 6 loại Ngọc gắn được vào lỗ trang bị (mỗi viên tăng thêm ô túi, hiện
                        +{bonuses.inlayExtraBagSlots} ô). Ngọc đang khảm được{' '}
                        <span className="text-stone-400">làm mờ</span> để dễ phân biệt với ngọc
                        sẵn sàng khảm trong Kho.
                      </p>
                    </div>

                    {gemToInlay && (
                      <div className="rounded-2xl bg-purple-950/40 border border-purple-400/50 p-3 flex items-center justify-between gap-2">
                        <div className="text-xs text-purple-100">
                          Đang chọn khảm: <strong>{gemToInlay.name}</strong> (
                          {describeGemEffect(gemToInlay.gemKind, gemToInlay.rarity)}) · Hãy chạm
                          vào một lỗ trống bên dưới.
                        </div>
                        <button
                          type="button"
                          onClick={() => setGemToInlay(null)}
                          className="min-h-[48px] px-3 rounded-xl bg-stone-900 text-xs text-stone-300 shrink-0"
                        >
                          Hủy
                        </button>
                      </div>
                    )}

                    {(['shovel', 'helmet', 'prop'] as EquipSlotId[]).map((slot) => {
                      const sockets = game.equipment[slot];
                      return (
                        <div
                          key={slot}
                          className="rounded-2xl bg-[#1b130d] border border-amber-800/35 p-3 flex flex-col min-[360px]:flex-row items-center gap-3"
                        >
                          <EquipmentSvg
                            slot={slot}
                            sockets={sockets}
                            onSocketTap={(idx) => {
                              ensureAudioUnlocked();
                              if (gemToInlay && sockets[idx] === null) {
                                handleSocketGem(slot, idx, gemToInlay);
                              } else {
                                setInlayTarget({ slot, socketIdx: idx });
                              }
                            }}
                          />
                          <div className="min-w-0 w-full flex-1 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <div className="font-display font-bold text-sm text-amber-200">
                                  {EQUIPMENT_META[slot].name}
                                </div>
                                <div className="text-[11px] text-stone-400">
                                  {EQUIPMENT_META[slot].subtitle}
                                </div>
                              </div>
                              <span className="text-[10px] text-stone-400 tabular-nums">
                                {sockets.length}/{GAME_CONFIG.MAX_SOCKETS_PER_EQUIP} lỗ
                              </span>
                            </div>
                            <div className="grid grid-cols-2 gap-1.5">
                              {sockets.map((gem, idx) => (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={() => {
                                    ensureAudioUnlocked();
                                    if (gemToInlay && !gem) {
                                      handleSocketGem(slot, idx, gemToInlay);
                                    } else {
                                      setInlayTarget({ slot, socketIdx: idx });
                                    }
                                  }}
                                  className={`min-h-[48px] rounded-xl border px-2 py-1 text-left transition ${
                                    gem
                                      ? 'bg-[#0e0906] border-stone-700/50 text-stone-400 opacity-50 grayscale-[35%]'
                                      : gemToInlay
                                        ? 'bg-purple-950/45 border-purple-400/80 text-purple-100 shadow-[0_0_12px_rgba(168,85,247,0.2)]'
                                        : 'bg-[#17100b] border-amber-700/45 text-amber-200'
                                  }`}
                                >
                                  {gem ? (
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      <ItemSvg
                                        templateId={gem.templateId}
                                        color={gem.color}
                                        size={18}
                                      />
                                      <div className="min-w-0 leading-tight">
                                        <div className="text-[11px] font-medium truncate">
                                          {gem.name}
                                        </div>
                                        <div className="text-[9px] text-stone-500">Đang khảm</div>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="text-xs font-medium truncate">
                                      {gemToInlay ? `Gắn vào Lỗ ${idx + 1}` : `Lỗ ${idx + 1}: Trống`}
                                    </div>
                                  )}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {/* Danh sách Ngọc đang có trong Kho để chọn khảm nhanh (Sáng rõ) */}
                    <div className="rounded-2xl bg-[#1a120c] border border-stone-800 p-3.5 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="font-display text-sm font-bold text-amber-200">
                          Ngọc Trong Kho Sẵn Sàng Khảm ({gemsInWarehouse.length})
                        </h3>
                        <span className="text-[11px] text-purple-300 tabular-nums">
                          {warehouseGemsValue} giá trị
                        </span>
                      </div>
                      {gemsInWarehouse.length === 0 ? (
                        <p className="text-xs text-stone-400">
                          Hiện chưa có viên ngọc nào trong Kho. Đào sâu hoặc ghé Phiên Chợ Thương
                          Nhân (mỗi 3 ngày) để mua ngọc.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {gemsInWarehouse.map((gem) => {
                            const selected = gemToInlay?.uid === gem.uid;
                            return (
                              <button
                                key={gem.uid}
                                type="button"
                                onClick={() =>
                                  setGemToInlay((prev) => (prev?.uid === gem.uid ? null : gem))
                                }
                                className={`w-full min-h-[56px] rounded-xl border p-2.5 flex items-center gap-3 text-left transition ${
                                  selected
                                    ? 'bg-purple-950/45 border-purple-400 shadow-[0_0_14px_rgba(168,85,247,0.22)]'
                                    : `bg-[#120c08] ${RARITY_INFO[gem.rarity].border}`
                                }`}
                              >
                                <ItemSvg templateId={gem.templateId} color={gem.color} size={32} />
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs font-bold text-amber-100">
                                    {gem.name} · {RARITY_INFO[gem.rarity].label}
                                  </div>
                                  <div className="text-[11px] text-purple-300">
                                    {describeGemEffect(gem.gemKind, gem.rarity)}
                                  </div>
                                </div>
                                <span className="text-xs font-semibold text-amber-300 shrink-0">
                                  {selected ? 'Đang chọn' : 'Chọn khảm'}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Ngọc đang khảm trên trang bị (hiển thị làm mờ để dễ phân biệt với ngọc trong Kho) */}
                    {inlaidGemEntries.length > 0 && (
                      <div className="rounded-2xl bg-[#140e0a] border border-stone-800/70 p-3.5 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="font-display text-xs font-bold text-stone-400">
                            Ngọc Đang Khảm Trên Trang Bị ({inlaidGemEntries.length})
                          </h3>
                          <span className="text-[11px] text-stone-500 tabular-nums">
                            {inlaidGemsValue} giá trị (không cống)
                          </span>
                        </div>
                        <div className="space-y-1.5">
                          {inlaidGemEntries.map(({ slot, socketIdx, gem }) => (
                            <button
                              key={`${slot}-${socketIdx}-${gem.uid}`}
                              type="button"
                              onClick={() => {
                                ensureAudioUnlocked();
                                setInlayTarget({ slot, socketIdx });
                              }}
                              className="w-full min-h-[52px] rounded-xl bg-[#0e0906] border border-stone-800/70 p-2 flex items-center gap-2.5 text-left opacity-50 grayscale-[35%] hover:opacity-75 transition"
                            >
                              <ItemSvg templateId={gem.templateId} color={gem.color} size={28} />
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-semibold text-stone-300 truncate">
                                  {gem.name} · {RARITY_INFO[gem.rarity].label}
                                </div>
                                <div className="text-[10px] text-stone-400 truncate">
                                  Đang khảm ở {EQUIPMENT_META[slot].name} (Lỗ {socketIdx + 1}) ·{' '}
                                  {describeGemEffect(gem.gemKind, gem.rarity)}
                                </div>
                              </div>
                              <span className="text-[10px] text-stone-400 shrink-0">Đang khảm</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* TAB 4: CHỢ, PHIÊN THƯƠNG NHÂN (MỖI 3 NGÀY) & GIÁ THỊ TRƯỜNG */}
                {game.workshopTab === 'market' && (
                  <>
                    {/* Tóm tắt túi dụng cụ & trang bị đặt trước cho ván kế */}
                    <div className="rounded-2xl bg-[#18110b] border border-sky-500/35 p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-display text-xs font-bold text-sky-200">
                          Hành Trang &amp; Chuẩn Bị Ván Kế (Ngày {game.day + 1})
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-xl bg-[#110c08] border border-stone-800 px-2.5 py-2 flex items-center justify-between">
                          <span className="text-stone-300">⏳ Đồng Hồ Cát</span>
                          <span className="font-bold text-sky-300 tabular-nums">
                            {game.timeRewinds ?? 0}
                          </span>
                        </div>
                        <div className="rounded-xl bg-[#110c08] border border-stone-800 px-2.5 py-2 flex items-center justify-between">
                          <span className="text-stone-300">💣 Mìn Phá Đá</span>
                          <span className="font-bold text-orange-300 tabular-nums">
                            {game.dynamiteCount ?? 0}
                          </span>
                        </div>
                      </div>
                      <div className="text-[11px] text-stone-400 leading-relaxed">
                        Ván kế: +{game.extraShovelsTomorrow} xẻng
                        {(game.bonusStartShieldTomorrow ?? 0) > 0
                          ? ` · +${game.bonusStartShieldTomorrow} khiên đầu`
                          : ''}
                        {game.hasMapForTomorrow ? ' · Bản đồ 3m' : ''}
                        {game.luckyDayTomorrow ? ' · 🧭 La Bàn May Mắn' : ''}
                        {game.superLampTomorrow ? ' · 🏮 Đèn Dầu Lớn' : ''}
                      </div>
                    </div>

                    {/* Quầy vật phẩm xoay vòng mỗi ngày (mua cuốc cho ván kế, đồng hồ cát, mìn, ngọc...) */}
                    <div className="rounded-2xl bg-[#1c140d] border border-amber-600/40 p-3.5 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="font-display text-sm font-bold text-amber-200">
                            Quầy Tiếp Tế Hôm Nay (Ưu Đãi Đổi Mới)
                          </div>
                          <div className="text-[11px] text-stone-400">
                            Xẻng &amp; bùa chỉ bán ở Chợ và áp dụng cho ván kế
                          </div>
                        </div>
                      </div>
                      <div className="space-y-2">
                        {game.dailyShopOffers.map((offer) => (
                          <div
                            key={offer.uid}
                            className={`rounded-xl bg-[#120c08] border p-2.5 flex items-center justify-between gap-2.5 ${
                              offer.sold ? 'border-stone-800/60 opacity-50' : 'border-amber-700/40'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-amber-100 truncate">
                                {offer.title}
                              </div>
                              <div className="text-[11px] text-stone-400 leading-snug">
                                {offer.subtitle}
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={offer.sold || game.coins < offer.price}
                              onClick={() => handleBuyDailyOffer(offer.uid)}
                              className="min-h-[48px] px-3 rounded-xl bg-amber-600 text-[#180f07] font-bold text-xs tabular-nums disabled:opacity-40 shrink-0 active:scale-95 transition"
                            >
                              {offer.sold ? 'Đã mua' : `${offer.price} xu`}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Phiên Chợ Thương Nhân Hầm Sâu (mỗi 3 ngày) */}
                    <div
                      className={`rounded-2xl border p-3.5 space-y-3 ${
                        merchantActiveToday
                          ? 'bg-[#21150c] border-amber-500/55 shadow-[0_0_24px_rgba(245,158,11,0.12)]'
                          : 'bg-[#1a120c] border-stone-800'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="font-display text-sm font-bold text-amber-200">
                            Đoàn Thương Nhân Ngọc &amp; Thợ Rèn
                          </div>
                          <div className="text-[11px] text-stone-400">
                            {merchantActiveToday
                              ? `Phiên chợ đặc biệt Ngày ${game.day} đang mở!`
                              : `Ghé thăm mỗi ${GAME_CONFIG.MERCHANT_INTERVAL_DAYS} ngày · Lần tới: Ngày ${nextMerchantDay} (còn ${nextMerchantDay - game.day} ngày)`}
                          </div>
                        </div>
                        <span
                          className={`text-[11px] font-bold px-2 py-1 rounded-lg ${
                            merchantActiveToday
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                              : 'bg-stone-900 text-stone-400'
                          }`}
                        >
                          {merchantActiveToday ? 'Đang mở' : `Ngày ${nextMerchantDay}`}
                        </span>
                      </div>

                      {merchantActiveToday ? (
                        <div className="space-y-3">
                          {/* Hàng ngọc quý để khảm */}
                          <div className="space-y-2">
                            <div className="text-xs font-semibold text-purple-200">
                              Ngọc Quý Khảm Trang Bị
                            </div>
                            {game.merchantOffers.map((offer) => {
                              const tpl = ITEM_TEMPLATES.find((t) => t.id === offer.templateId);
                              if (!tpl) return null;
                              return (
                                <div
                                  key={offer.uid}
                                  className={`rounded-xl bg-[#120c08] border p-2.5 flex items-center justify-between gap-2.5 ${
                                    offer.sold
                                      ? 'border-stone-800/60 opacity-50'
                                      : RARITY_INFO[offer.rarity].border
                                  }`}
                                >
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <ItemSvg templateId={tpl.id} color={tpl.color} size={32} />
                                    <div className="min-w-0">
                                      <div className="text-xs font-bold text-amber-100 truncate">
                                        {tpl.name} ·{' '}
                                        <span className={RARITY_INFO[offer.rarity].text}>
                                          {RARITY_INFO[offer.rarity].label}
                                        </span>
                                      </div>
                                      <div className="text-[11px] text-purple-300">
                                        {describeGemEffect(tpl.gemKind, offer.rarity)}
                                      </div>
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    disabled={offer.sold || game.coins < offer.price}
                                    onClick={() => handleBuyMerchantGem(offer.uid)}
                                    className="min-h-[48px] px-3 rounded-xl bg-amber-600 text-[#180f07] font-bold text-xs tabular-nums disabled:opacity-40 shrink-0 active:scale-95 transition"
                                  >
                                    {offer.sold ? 'Đã mua' : `${offer.price} xu`}
                                  </button>
                                </div>
                              );
                            })}
                          </div>

                          {/* Mở rộng lỗ khảm trang bị */}
                          <div className="pt-2 border-t border-amber-900/30 space-y-2">
                            <div className="text-xs font-semibold text-amber-200">
                              Đục Thêm Lỗ Khảm (Tối đa {GAME_CONFIG.MAX_SOCKETS_PER_EQUIP} lỗ/món)
                            </div>
                            <div className="space-y-1.5">
                              {(['shovel', 'helmet', 'prop'] as EquipSlotId[]).map((slot) => {
                                const curSockets = game.equipment[slot].length;
                                const isMax = curSockets >= GAME_CONFIG.MAX_SOCKETS_PER_EQUIP;
                                const cost = GAME_CONFIG.SOCKET_UPGRADE_COSTS[curSockets] ?? 95;
                                return (
                                  <div
                                    key={slot}
                                    className="rounded-xl bg-[#120c08] border border-stone-800 p-2.5 flex items-center justify-between gap-2"
                                  >
                                    <div className="min-w-0">
                                      <div className="text-xs font-bold text-amber-100">
                                        +1 Lỗ Khảm · {EQUIPMENT_META[slot].name}
                                      </div>
                                      <div className="text-[11px] text-stone-400 tabular-nums">
                                        Hiện tại: {curSockets}/{GAME_CONFIG.MAX_SOCKETS_PER_EQUIP} lỗ
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      disabled={isMax || game.coins < cost}
                                      onClick={() => handleUpgradeEquipSocket(slot)}
                                      className="min-h-[48px] px-3 rounded-xl bg-amber-600 text-[#180f07] font-bold text-xs tabular-nums disabled:opacity-40 shrink-0 active:scale-95 transition"
                                    >
                                      {isMax ? 'Tối đa' : `${cost} xu`}
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-stone-400 leading-relaxed">
                          Thương nhân mang theo nhiều loại Ngọc quý (Hồng ngọc, Lam ngọc, Hoàng
                          ngọc, Kim cương...) và dịch vụ đục thêm lỗ khảm trang bị (tối đa 4 lỗ).
                          Hãy tích xu từ bán đồ &amp; phần dư nộp cống để mua sắm vào Ngày{' '}
                          {nextMerchantDay}!
                        </p>
                      )}
                    </div>

                    <div className="rounded-2xl bg-[#1a120c] border border-stone-800 p-3.5 space-y-2">
                      <div className="font-display text-sm font-bold text-amber-200">
                        Biến Động Giá Chợ Hôm Nay (±20%)
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center text-xs">
                        {(
                          [
                            { key: 'ore', label: 'Quặng' },
                            { key: 'gem', label: 'Ngọc' },
                            { key: 'relic', label: 'Di vật' },
                          ] as { key: ItemCategory; label: string }[]
                        ).map((cat) => {
                          const pct = Math.round((game.market[cat.key] - 1) * 100);
                          return (
                            <div
                              key={cat.key}
                              className="rounded-xl bg-[#110c08] border border-stone-800 py-2 px-1"
                            >
                              <div className="text-stone-400">{cat.label}</div>
                              <div
                                className={`font-bold tabular-nums mt-0.5 ${
                                  pct >= 0 ? 'text-emerald-300' : 'text-rose-300'
                                }`}
                              >
                                {pct >= 0 ? `+${pct}%` : `${pct}%`}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-2.5">
                      <div className="rounded-2xl bg-[#1b130d] border border-amber-800/35 p-3.5 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-display font-bold text-sm text-amber-100">
                            🪏 Mua Thêm Xẻng (Áp dụng ván kế)
                          </div>
                          <div className="text-xs text-stone-400">
                            Chỉ dùng cho Ngày {game.day + 1} · Đã đặt: +{game.extraShovelsTomorrow} xẻng
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={game.coins < GAME_CONFIG.SHOP_PRICES.extraShovel}
                          onClick={() => handleBuyUpgrade('shovel')}
                          className="min-h-[48px] px-4 rounded-xl bg-amber-600 text-[#180f07] font-bold text-xs tabular-nums disabled:opacity-40 shrink-0 active:scale-95 transition"
                        >
                          {GAME_CONFIG.SHOP_PRICES.extraShovel} xu
                        </button>
                      </div>

                      <div className="rounded-2xl bg-[#1b130d] border border-sky-600/40 p-3.5 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-display font-bold text-sm text-sky-200">
                            ⏳ Đồng Hồ Cát Thời Gian
                          </div>
                          <div className="text-xs text-stone-300 leading-snug">
                            Khi sập hầm, tua ngược về trước cú sập để cứu toàn bộ túi, khiên &amp; chuỗi!
                          </div>
                          <div className="text-[11px] text-sky-300/80 mt-0.5 tabular-nums">
                            Đang giữ: {game.timeRewinds ?? 0} cái
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={game.coins < GAME_CONFIG.SHOP_PRICES.timeRewind}
                          onClick={() => handleBuyUpgrade('timeRewind')}
                          className="min-h-[48px] px-4 rounded-xl bg-sky-500 text-[#07131a] font-bold text-xs tabular-nums disabled:opacity-40 shrink-0 active:scale-95 transition"
                        >
                          {GAME_CONFIG.SHOP_PRICES.timeRewind} xu
                        </button>
                      </div>

                      <div className="rounded-2xl bg-[#1b130d] border border-orange-600/40 p-3.5 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-display font-bold text-sm text-orange-200">
                            💣 Mìn Phá Đá
                          </div>
                          <div className="text-xs text-stone-300 leading-snug">
                            Kích hoạt trong hầm: đào +1m với 0% sập, chắc chắn đồ Hiếm+ &amp; +1 chuỗi.
                          </div>
                          <div className="text-[11px] text-orange-300/80 mt-0.5 tabular-nums">
                            Đang giữ: {game.dynamiteCount ?? 0} quả
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={game.coins < GAME_CONFIG.SHOP_PRICES.dynamite}
                          onClick={() => handleBuyUpgrade('dynamite')}
                          className="min-h-[48px] px-4 rounded-xl bg-orange-500 text-[#180a04] font-bold text-xs tabular-nums disabled:opacity-40 shrink-0 active:scale-95 transition"
                        >
                          {GAME_CONFIG.SHOP_PRICES.dynamite} xu
                        </button>
                      </div>

                      <div className="rounded-2xl bg-[#1b130d] border border-emerald-700/40 p-3.5 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-display font-bold text-sm text-emerald-200">
                            🧭 La Bàn May Mắn (Ván kế)
                          </div>
                          <div className="text-xs text-stone-400">
                            Ngày {game.day + 1}: -4% nguy cơ sập &amp; tăng mạnh tỉ lệ đồ Hiếm/Sử thi/Huyền thoại
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={
                            game.coins < GAME_CONFIG.SHOP_PRICES.luckyCompass ||
                            Boolean(game.luckyDayTomorrow)
                          }
                          onClick={() => handleBuyUpgrade('luckyCompass')}
                          className="min-h-[48px] px-4 rounded-xl bg-amber-600 text-[#180f07] font-bold text-xs tabular-nums disabled:opacity-40 shrink-0 active:scale-95 transition"
                        >
                          {game.luckyDayTomorrow
                            ? 'Đã mua'
                            : `${GAME_CONFIG.SHOP_PRICES.luckyCompass} xu`}
                        </button>
                      </div>

                      <div className="rounded-2xl bg-[#1b130d] border border-amber-600/40 p-3.5 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-display font-bold text-sm text-amber-200">
                            🏮 Đèn Dầu Cỡ Lớn (Ván kế)
                          </div>
                          <div className="text-xs text-stone-400">
                            Ngày {game.day + 1}: Soi loại đồ tầng kế tiếp &amp; +12% giá trị mọi món đào
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={
                            game.coins < GAME_CONFIG.SHOP_PRICES.superLamp ||
                            Boolean(game.superLampTomorrow)
                          }
                          onClick={() => handleBuyUpgrade('superLamp')}
                          className="min-h-[48px] px-4 rounded-xl bg-amber-600 text-[#180f07] font-bold text-xs tabular-nums disabled:opacity-40 shrink-0 active:scale-95 transition"
                        >
                          {game.superLampTomorrow
                            ? 'Đã mua'
                            : `${GAME_CONFIG.SHOP_PRICES.superLamp} xu`}
                        </button>
                      </div>

                      <div className="rounded-2xl bg-[#1b130d] border border-amber-800/35 p-3.5 flex items-center justify-between gap-3">
                        <div>
                          <div className="font-display font-bold text-sm text-amber-100">
                            Mở Rộng Túi Đào (+1 ô gốc)
                          </div>
                          <div className="text-xs text-stone-400">
                            Tổng sức chứa: {maxBagSlots} ô ({game.baseBagSlots} gốc +{' '}
                            {bonuses.inlayExtraBagSlots} ngọc + {bonuses.setExtraBagSlots} bộ)
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={game.coins < GAME_CONFIG.SHOP_PRICES.bagSlot}
                          onClick={() => handleBuyUpgrade('bag')}
                          className="min-h-[48px] px-4 rounded-xl bg-amber-600 text-[#180f07] font-bold text-xs tabular-nums disabled:opacity-40 shrink-0 active:scale-95 transition"
                        >
                          {GAME_CONFIG.SHOP_PRICES.bagSlot} xu
                        </button>
                      </div>

                      <div className="rounded-2xl bg-[#1b130d] border border-amber-800/35 p-3.5 flex items-center justify-between gap-3">
                        <div>
                          <div className="font-display font-bold text-sm text-amber-100">
                            Mở Rộng Tủ Kính (+1 ô)
                          </div>
                          <div className="text-xs text-stone-400">
                            Hiện có: {game.showcaseSlots}/{GAME_CONFIG.MAX_SHOWCASE_SLOTS} ô
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={
                            game.coins < GAME_CONFIG.SHOP_PRICES.showcaseSlot ||
                            game.showcaseSlots >= GAME_CONFIG.MAX_SHOWCASE_SLOTS
                          }
                          onClick={() => handleBuyUpgrade('showcase')}
                          className="min-h-[48px] px-4 rounded-xl bg-amber-600 text-[#180f07] font-bold text-xs tabular-nums disabled:opacity-40 shrink-0 active:scale-95 transition"
                        >
                          {game.showcaseSlots >= GAME_CONFIG.MAX_SHOWCASE_SLOTS
                            ? 'Tối đa'
                            : `${GAME_CONFIG.SHOP_PRICES.showcaseSlot} xu`}
                        </button>
                      </div>

                      <div className="rounded-2xl bg-[#1b130d] border border-amber-800/35 p-3.5 flex items-center justify-between gap-3">
                        <div>
                          <div className="font-display font-bold text-sm text-amber-100">
                            🗺️ Bản Đồ Hầm Sâu (Ván kế)
                          </div>
                          <div className="text-xs text-stone-400">
                            Ngày {game.day + 1}: Mỗi lượt bắt đầu thẳng ở độ sâu {GAME_CONFIG.MAP_START_DEPTH} m
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={
                            game.coins < GAME_CONFIG.SHOP_PRICES.map || game.hasMapForTomorrow
                          }
                          onClick={() => handleBuyUpgrade('map')}
                          className="min-h-[48px] px-4 rounded-xl bg-amber-600 text-[#180f07] font-bold text-xs tabular-nums disabled:opacity-40 shrink-0 active:scale-95 transition"
                        >
                          {game.hasMapForTomorrow
                            ? 'Đã mua'
                            : `${GAME_CONFIG.SHOP_PRICES.map} xu`}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Thanh CTA đáy Xưởng */}
              <div className="shrink-0 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] bg-[#19110b] border-t border-amber-700/30">
                <button
                  type="button"
                  onClick={() => {
                    ensureAudioUnlocked();
                    setGame((prev) => ({ ...prev, phase: 'TRIBUTE' }));
                  }}
                  className="w-full min-h-[54px] rounded-2xl bg-gradient-to-b from-amber-500 to-amber-700 text-[#180f07] font-display font-extrabold text-base tracking-wide shadow-[0_6px_24px_rgba(245,158,11,0.3)] active:scale-[0.98] transition"
                >
                  Đến Nộp Cống Ngày {game.day} →
                </button>
              </div>
            </section>
          )}

          {/* ============================================================== */}
          {/* GIAI ĐOẠN 3: NỘP CỐNG CHỦ MỎ */}
          {/* ============================================================== */}
          {game.phase === 'TRIBUTE' && (
            <section className="flex-1 flex flex-col min-h-0 animate-phase">
              <div className="shrink-0 p-4 bg-[#18110b] border-b border-amber-800/30 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="font-display text-lg font-bold text-amber-200">
                      Nộp Cống Chủ Mỏ
                    </h2>
                    <p className="text-xs text-stone-400">
                      Chỉ đồ đào được trong Ngày {game.day} mới nộp cống được. Ngọc mua, đang khảm
                      hoặc đồ ngày cũ tách riêng.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setGame((prev) => ({ ...prev, phase: 'WORKSHOP' }))}
                    className="min-h-[48px] px-3 rounded-xl border border-stone-700 text-xs text-stone-300 font-medium shrink-0"
                  >
                    ← Xưởng
                  </button>
                </div>

                {/* Phân biệt rõ nguồn tiền hôm nay vs tổng giá trị ngọc */}
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-xl bg-[#110c08] border border-emerald-800/40 px-2.5 py-2 flex items-center justify-between">
                    <span className="text-stone-400">Kiếm hôm nay:</span>
                    <span className="font-bold text-emerald-300 tabular-nums">
                      {todayEarnedWarehouseTotal}
                    </span>
                  </div>
                  <div className="rounded-xl bg-[#110c08] border border-purple-800/40 px-2.5 py-2 flex items-center justify-between">
                    <span className="text-stone-400">Tổng ngọc có:</span>
                    <span className="font-bold text-purple-300 tabular-nums">
                      {totalOwnedGemsValue}
                    </span>
                  </div>
                </div>

                {/* Thanh tiến độ cống */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-stone-300">Giá trị đã chọn nộp</span>
                    <span
                      className={`font-bold tabular-nums ${
                        selectedTributeTotal >= tributeRequired
                          ? 'text-emerald-300'
                          : 'text-rose-300'
                      }`}
                    >
                      {selectedTributeTotal} / {tributeRequired}
                    </span>
                  </div>
                  <div className="h-3 rounded-full bg-[#0d0906] border border-stone-800 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        selectedTributeTotal >= tributeRequired
                          ? 'bg-gradient-to-r from-emerald-600 to-emerald-400'
                          : 'bg-gradient-to-r from-amber-700 to-amber-500'
                      }`}
                      style={{
                        width: `${Math.min(100, (selectedTributeTotal / tributeRequired) * 100)}%`,
                      }}
                    />
                  </div>
                  {surplusTributeCoins > 0 && (
                    <div className="flex items-center justify-between text-xs pt-0.5">
                      <span className="text-stone-400">Phần dư cống nạp đổi thành xu:</span>
                      <span className="font-bold text-amber-300 tabular-nums">
                        +{surplusTributeCoins} xu
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {game.warehouse.length === 0 ? (
                  <div className="rounded-2xl bg-[#1a120c] border border-stone-800 p-6 text-center text-xs text-stone-400">
                    Không còn vật phẩm nào trong Kho để nộp cống.
                  </div>
                ) : (
                  game.warehouse.map((item) => {
                    const disabled = !isItemEligibleForTodayTribute(item, game.day);
                    const checked = !disabled && selectedTributeUids.includes(item.uid);
                    return (
                      <button
                        key={item.uid}
                        type="button"
                        disabled={disabled}
                        onClick={() => handleToggleTributeUid(item.uid)}
                        className={`w-full min-h-[60px] rounded-2xl border p-3 flex items-center gap-3 text-left transition ${
                          disabled
                            ? 'bg-[#140e0a] border-stone-800/60 opacity-50'
                            : checked
                              ? 'bg-emerald-950/35 border-emerald-500/60'
                              : 'bg-[#19110b] border-stone-800 opacity-75'
                        }`}
                      >
                        <div
                          className={`w-6 h-6 rounded-md border flex items-center justify-center shrink-0 ${
                            checked
                              ? 'bg-emerald-500 border-emerald-400 text-[#0d0906] font-bold'
                              : 'border-stone-600'
                          }`}
                        >
                          {checked ? '✓' : ''}
                        </div>
                        <ItemSvg templateId={item.templateId} color={item.color} size={32} />
                        <div className="min-w-0 flex-1">
                          <div className="font-display font-bold text-sm text-amber-100 truncate">
                            {item.name}
                          </div>
                          <div className="text-[11px] text-stone-400">
                            {disabled
                              ? getNonTributeReasonLabel(item, game.day)
                              : `${RARITY_INFO[item.rarity].label} · Đào hôm nay`}
                          </div>
                        </div>
                        <div
                          className={`text-sm font-bold tabular-nums shrink-0 ${
                            disabled ? 'text-stone-500' : 'text-amber-300'
                          }`}
                        >
                          {disabled ? `${item.value} (Không cống)` : `+${item.value}`}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              <div className="shrink-0 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] bg-[#19110b] border-t border-amber-700/30">
                <button
                  type="button"
                  onClick={handleSubmitTribute}
                  className={`w-full min-h-[56px] rounded-2xl font-display font-extrabold text-base tracking-wide active:scale-[0.98] transition ${
                    selectedTributeTotal >= tributeRequired
                      ? 'bg-gradient-to-b from-emerald-500 to-emerald-700 text-[#08150f] shadow-[0_6px_24px_rgba(16,185,129,0.28)]'
                      : 'bg-gradient-to-b from-rose-700 to-rose-900 text-rose-100'
                  }`}
                >
                  {selectedTributeTotal >= tributeRequired
                    ? !game.endlessMode && game.day >= GAME_CONFIG.CAMPAIGN_DAYS
                      ? `Nộp Cống Cuối${surplusTributeCoins > 0 ? ` (+${surplusTributeCoins} xu)` : ''} — Trả Hết Nợ!`
                      : `Nộp Cống${surplusTributeCoins > 0 ? ` (+${surplusTributeCoins} xu)` : ''} & Sang Ngày ${game.day + 1}`
                    : 'Không Đủ Cống — Chấp Nhận Thua'}
                </button>
              </div>
            </section>
          )}

          {/* ============================================================== */}
          {/* MÀN HÌNH CHIẾN THẮNG / THẤT BẠI */}
          {/* ============================================================== */}
          {(game.phase === 'VICTORY' || game.phase === 'DEFEAT') && (
            <section className="flex-1 flex flex-col justify-between p-5 animate-phase overflow-y-auto">
              <div className="mt-6 space-y-5 text-center">
                <div
                  className={`mx-auto w-20 h-20 rounded-full border flex items-center justify-center ${
                    game.phase === 'VICTORY'
                      ? 'bg-amber-900/35 border-amber-400/70 shadow-[0_0_36px_rgba(251,191,36,0.35)]'
                      : 'bg-rose-950/50 border-rose-500/60'
                  }`}
                >
                  <span className="font-display text-3xl font-bold text-amber-200">
                    {game.phase === 'VICTORY' ? '★' : '✕'}
                  </span>
                </div>

                <div className="space-y-2">
                  <h2
                    className={`font-display text-2xl font-extrabold ${
                      game.phase === 'VICTORY' ? 'text-amber-300' : 'text-rose-300'
                    }`}
                  >
                    {game.phase === 'VICTORY'
                      ? 'Thoát Nợ Thành Công!'
                      : 'Vỡ Nợ Trước Chủ Mỏ'}
                  </h2>
                  <p className="text-sm text-stone-300 leading-relaxed max-w-xs mx-auto">
                    {game.phase === 'VICTORY'
                      ? `Bạn đã vượt qua cả ${GAME_CONFIG.CAMPAIGN_DAYS} ngày khắc nghiệt, trả sòng phẳng món nợ! Bạn có thể tiếp tục xuống hầm ở Chế Độ Vô Tận.`
                      : `Bạn gục ngã ở Ngày ${game.day} vì không đủ ${tributeRequired} giá trị cống nạp.`}
                  </p>
                </div>

                <div className="rounded-2xl bg-[#1a120c] border border-amber-800/35 p-4 grid grid-cols-2 gap-3 text-left text-xs">
                  <div>
                    <div className="text-stone-400">Độ sâu kỷ lục</div>
                    <div className="text-base font-bold text-amber-200 tabular-nums">
                      {game.stats.maxDepth} m
                    </div>
                  </div>
                  <div>
                    <div className="text-stone-400">Tổng vật phẩm đào</div>
                    <div className="text-base font-bold text-amber-200 tabular-nums">
                      {game.stats.totalDug} món
                    </div>
                  </div>
                  <div>
                    <div className="text-stone-400">Số lần sập hầm</div>
                    <div className="text-base font-bold text-rose-300 tabular-nums">
                      {game.stats.collapses}
                    </div>
                  </div>
                  <div>
                    <div className="text-stone-400">Khiên tự cứu</div>
                    <div className="text-base font-bold text-emerald-300 tabular-nums">
                      {game.stats.shieldSaves} lần
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-4 space-y-2.5">
                {game.phase === 'VICTORY' && (
                  <button
                    type="button"
                    onClick={handleContinueEndless}
                    className="w-full min-h-[56px] rounded-2xl bg-gradient-to-b from-amber-500 to-amber-700 text-[#180f07] font-display font-extrabold text-base tracking-wide shadow-[0_6px_24px_rgba(245,158,11,0.32)] active:scale-[0.98] transition"
                  >
                    Tiếp Tục Đào Vô Tận (Ngày {game.day + 1}) →
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleRestartGame}
                  className={`w-full min-h-[54px] rounded-2xl font-display font-extrabold text-base tracking-wide active:scale-[0.98] transition ${
                    game.phase === 'VICTORY'
                      ? 'bg-[#251a12] border border-amber-700/45 text-amber-200'
                      : 'bg-gradient-to-b from-amber-500 to-amber-700 text-[#180f07]'
                  }`}
                >
                  Chơi Lại Từ Ngày 1
                </button>
              </div>
            </section>
          )}

          {/* ============================================================== */}
          {/* CÁC MODAL / DRAWER CẢM ỨNG */}
          {/* ============================================================== */}

          {/* Modal Kích Hoạt Đồng Hồ Cát Quay Ngược Thời Gian khi Sập Hầm */}
          {pendingRewind && (
            <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="w-full max-w-sm rounded-2xl bg-[#12161e] border border-sky-400/70 p-4 space-y-3.5 shadow-[0_0_36px_rgba(56,189,248,0.3)] animate-alert-pop">
                <div className="text-center space-y-1.5">
                  <div className="text-3xl" aria-hidden="true">
                    ⏳
                  </div>
                  <h3 className="font-display text-lg font-extrabold text-sky-200">
                    ĐỒNG HỒ CÁT PHÁT SÁNG!
                  </h3>
                  <p className="text-xs text-stone-300 leading-relaxed">
                    Hầm vừa sập ở độ sâu{' '}
                    <strong className="text-rose-300">{pendingRewind.collapsedAtDepth} m</strong> (mất{' '}
                    <strong className="text-amber-200">{pendingRewind.lostCount} món</strong> trong
                    túi). Bạn có thể dùng 1 Đồng Hồ Cát để{' '}
                    <strong className="text-sky-200">quay ngược thời gian</strong> về lại{' '}
                    <strong className="text-amber-200">{pendingRewind.depth} m</strong> và giữ toàn bộ
                    túi đồ, khiên ({pendingRewind.shieldPoints}/{GAME_CONFIG.SHIELD_THRESHOLD}) &amp;
                    chuỗi ({pendingRewind.safeDigStreak}/{GAME_CONFIG.FRENZY_STREAK_REQUIRED})!
                  </p>
                </div>

                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={handleConfirmTimeRewind}
                    className="w-full min-h-[54px] rounded-xl bg-gradient-to-b from-sky-400 to-sky-600 text-[#06131c] font-display font-extrabold text-sm tracking-wide shadow-[0_6px_20px_rgba(56,189,248,0.35)] active:scale-[0.98] transition"
                  >
                    ⏳ Quay Ngược Thời Gian (Còn {game.timeRewinds ?? 0} cái)
                  </button>
                  <button
                    type="button"
                    onClick={handleDeclineTimeRewind}
                    className="w-full min-h-[48px] rounded-xl bg-stone-900 border border-stone-700 text-stone-300 font-semibold text-xs active:scale-[0.98] transition"
                  >
                    Chấp Nhận Sập Hầm (Giữ Đồng Hồ Cát)
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Modal xem thuộc tính Ngọc / Vật phẩm đang đào được (có thể bỏ ngay hoặc mở chọn nhiều) */}
          {inspectedMiningItem && (
            <div className="absolute inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="w-full max-w-sm rounded-2xl bg-[#1a120c] border border-amber-600/50 p-4 space-y-3 animate-alert-pop">
                {(() => {
                  const tpl = ITEM_TEMPLATES.find((t) => t.id === inspectedMiningItem.templateId);
                  const isInBag =
                    game.inShaft && game.bag.some((b) => b.uid === inspectedMiningItem.uid);
                  return (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-12 h-12 rounded-xl bg-[#110b07] border border-amber-800/40 flex items-center justify-center shrink-0">
                            <ItemSvg
                              templateId={inspectedMiningItem.templateId}
                              color={inspectedMiningItem.color}
                              size={36}
                            />
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-display text-base font-bold text-amber-200 truncate">
                              {inspectedMiningItem.name}
                            </h3>
                            <p className="text-xs text-stone-400 tabular-nums">
                              <span className={RARITY_INFO[inspectedMiningItem.rarity].text}>
                                {RARITY_INFO[inspectedMiningItem.rarity].label}
                              </span>
                              {' · '}
                              {inspectedMiningItem.value} giá trị
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setInspectedMiningItem(null)}
                          className="min-h-[48px] px-3 rounded-xl bg-stone-800 text-xs text-stone-200 shrink-0"
                        >
                          Đóng
                        </button>
                      </div>

                      {inspectedMiningItem.category === 'gem' ? (
                        <div className="rounded-xl bg-purple-950/40 border border-purple-500/40 p-3 space-y-1">
                          <div className="text-xs font-bold text-purple-200">
                            Thuộc tính khi khảm vào trang bị:
                          </div>
                          <div className="text-xs text-amber-100">
                            {describeGemEffect(
                              inspectedMiningItem.gemKind,
                              inspectedMiningItem.rarity
                            )}
                          </div>
                        </div>
                      ) : inspectedMiningItem.category === 'relic' && inspectedMiningItem.relicSet ? (
                        <div className="rounded-xl bg-amber-950/35 border border-amber-500/40 p-3 space-y-1">
                          <div className="text-xs font-bold text-amber-200">
                            Thuộc {RELIC_SETS[inspectedMiningItem.relicSet].name}
                          </div>
                          <div className="text-xs text-stone-300">
                            Thưởng bộ: {RELIC_SETS[inspectedMiningItem.relicSet].bonusLabel}
                          </div>
                        </div>
                      ) : null}

                      {tpl && (
                        <p className="text-xs text-stone-400 leading-relaxed">{tpl.description}</p>
                      )}

                      {isInBag && (
                        <div className="grid grid-cols-2 gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              handleDropBagItem(inspectedMiningItem.uid);
                              setInspectedMiningItem(null);
                            }}
                            className="min-h-[48px] rounded-xl bg-rose-950/65 border border-rose-500/45 text-rose-200 font-semibold text-xs active:scale-95 transition"
                          >
                            Bỏ Món Này
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setInspectedMiningItem(null);
                              setShowBagDrawer(true);
                            }}
                            className="min-h-[48px] rounded-xl bg-[#271b11] border border-amber-600/40 text-amber-100 font-semibold text-xs active:scale-95 transition"
                          >
                            Bỏ Nhiều Món...
                          </button>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Drawer Túi đầy / Quản lý túi trong lượt đào (bỏ 1 hoặc nhiều bất kỳ lúc nào) */}
          {(showBagDrawer || overflowItem) && (
            <div className="absolute inset-0 z-40 bg-black/75 backdrop-blur-sm flex items-end">
              <div className="w-full rounded-t-3xl bg-[#1a120c] border-t border-amber-600/40 p-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] space-y-3 max-h-[84%] flex flex-col">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="font-display text-base font-bold text-amber-200">
                      {overflowItem ? 'Túi Đã Đầy!' : `Túi Đào (${game.bag.length}/${maxBagSlots})`}
                    </h3>
                    <p className="text-xs text-stone-400">
                      {overflowItem
                        ? `Vừa tìm thấy ${overflowItem.name} (${overflowItem.value} giá trị). Chọn món để thay thế hoặc bỏ món mới.`
                        : 'Chạm Bỏ để bỏ ngay 1 món, hoặc đánh dấu chọn nhiều món để bỏ cùng lúc.'}
                    </p>
                    {overflowItem?.category === 'gem' && (
                      <p className="text-[11px] text-purple-300 mt-1">
                        Thuộc tính ngọc mới:{' '}
                        {describeGemEffect(overflowItem.gemKind, overflowItem.rarity)}
                      </p>
                    )}
                  </div>
                  {!overflowItem && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowBagDrawer(false);
                        setSelectedDropUids([]);
                      }}
                      className="min-h-[48px] px-3 rounded-xl bg-stone-800 text-xs text-stone-200 shrink-0"
                    >
                      Đóng
                    </button>
                  )}
                </div>

                {!overflowItem && game.bag.length > 0 && (
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-stone-400">
                      Đã chọn:{' '}
                      <strong className="text-rose-300 tabular-nums">
                        {selectedDropUids.length}
                      </strong>{' '}
                      món
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedDropUids((prev) =>
                          prev.length === game.bag.length ? [] : game.bag.map((i) => i.uid)
                        )
                      }
                      className="min-h-[48px] px-3 rounded-xl bg-[#251a12] border border-amber-700/35 text-amber-200 font-semibold text-xs"
                    >
                      {selectedDropUids.length === game.bag.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                    </button>
                  </div>
                )}

                <div className="flex-1 overflow-y-auto space-y-2">
                  {game.bag.length === 0 ? (
                    <div className="py-8 text-center text-xs text-stone-400">
                      Túi đào hiện đang trống.
                    </div>
                  ) : (
                    game.bag.map((item) => {
                      const isChecked = !overflowItem && selectedDropUids.includes(item.uid);
                      return (
                        <div
                          key={item.uid}
                          className={`rounded-xl border p-2.5 flex items-center justify-between gap-2 transition ${
                            isChecked
                              ? 'bg-rose-950/30 border-rose-500/60'
                              : 'bg-[#120c08] border-stone-800'
                          }`}
                        >
                          <button
                            type="button"
                            disabled={Boolean(overflowItem)}
                            onClick={() => !overflowItem && handleToggleDropUid(item.uid)}
                            className="flex items-center gap-2.5 min-w-0 flex-1 text-left min-h-[48px]"
                          >
                            {!overflowItem && (
                              <span
                                className={`w-6 h-6 rounded-md border flex items-center justify-center shrink-0 text-xs font-bold ${
                                  isChecked
                                    ? 'bg-rose-500 border-rose-400 text-white'
                                    : 'border-stone-600 text-transparent'
                                }`}
                              >
                                ✓
                              </span>
                            )}
                            <ItemSvg templateId={item.templateId} color={item.color} size={30} />
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-amber-100 truncate">
                                {item.name}
                              </div>
                              <div className="text-[11px] text-stone-400 tabular-nums">
                                {RARITY_INFO[item.rarity].label} · {item.value} giá trị
                              </div>
                              {item.category === 'gem' ? (
                                <div className="text-[10px] text-purple-300 truncate">
                                  Khảm: {describeGemEffect(item.gemKind, item.rarity)}
                                </div>
                              ) : item.category === 'relic' && item.relicSet ? (
                                <div className="text-[10px] text-amber-300/80 truncate">
                                  {RELIC_SETS[item.relicSet].name}
                                </div>
                              ) : null}
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDropBagItem(item.uid)}
                            className="min-h-[48px] px-3 rounded-xl bg-rose-950/60 border border-rose-500/40 text-xs font-semibold text-rose-200 shrink-0 active:scale-95 transition"
                          >
                            {overflowItem ? 'Thay thế' : 'Bỏ'}
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>

                {!overflowItem && selectedDropUids.length > 0 && (
                  <button
                    type="button"
                    onClick={handleDropSelectedBagItems}
                    className="w-full min-h-[52px] rounded-xl bg-gradient-to-b from-rose-600 to-rose-800 text-white font-bold text-xs active:scale-[0.98] transition"
                  >
                    Bỏ {selectedDropUids.length} Món Đã Chọn Khỏi Túi
                  </button>
                )}

                {overflowItem && (
                  <button
                    type="button"
                    onClick={() => setOverflowItem(null)}
                    className="w-full min-h-[50px] rounded-xl bg-stone-800 text-stone-200 font-semibold text-xs"
                  >
                    Giữ Túi Hiện Tại (Bỏ {overflowItem.name})
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Modal Khảm / Tháo ngọc vào lỗ trang bị */}
          {inlayTarget && (
            <div className="absolute inset-0 z-40 bg-black/75 backdrop-blur-sm flex items-end">
              <div className="w-full rounded-t-3xl bg-[#1a120c] border-t border-amber-600/40 p-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] space-y-3 max-h-[82%] flex flex-col">
                {(() => {
                  const currentGem = game.equipment[inlayTarget.slot][inlayTarget.socketIdx];
                  return (
                    <>
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-display text-base font-bold text-amber-200">
                            {EQUIPMENT_META[inlayTarget.slot].name} · Lỗ {inlayTarget.socketIdx + 1}
                          </h3>
                          <p className="text-xs text-stone-400">
                            {currentGem
                              ? describeGemEffect(currentGem.gemKind, currentGem.rarity)
                              : 'Chọn một viên ngọc trong Kho để khảm vào lỗ này.'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setInlayTarget(null)}
                          className="min-h-[48px] px-3 rounded-xl bg-stone-800 text-xs text-stone-200"
                        >
                          Đóng
                        </button>
                      </div>

                      {currentGem ? (
                        <div className="space-y-3">
                          <div className="rounded-xl bg-[#0e0906] border border-stone-700/60 p-3 flex items-center gap-3 opacity-60 grayscale-[35%]">
                            <ItemSvg
                              templateId={currentGem.templateId}
                              color={currentGem.color}
                              size={36}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wide">
                                Đang khảm trên trang bị
                              </div>
                              <div className="font-bold text-sm text-stone-200 truncate">
                                {currentGem.name} ({RARITY_INFO[currentGem.rarity].label})
                              </div>
                              <div className="text-xs text-emerald-300/80">
                                {describeGemEffect(currentGem.gemKind, currentGem.rarity)}
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={game.coins < GAME_CONFIG.SHOP_PRICES.removeGem}
                            onClick={() => {
                              handleRemoveGem(inlayTarget.slot, inlayTarget.socketIdx);
                              setInlayTarget(null);
                            }}
                            className="w-full min-h-[50px] rounded-xl bg-rose-950/60 border border-rose-500/45 text-rose-200 font-semibold text-xs disabled:opacity-40"
                          >
                            Tháo Ngọc Về Kho (-{GAME_CONFIG.SHOP_PRICES.removeGem} xu)
                          </button>
                        </div>
                      ) : gemsInWarehouse.length === 0 ? (
                        <p className="text-xs text-stone-400 py-4 text-center">
                          Trong Kho chưa có viên ngọc nào để khảm.
                        </p>
                      ) : (
                        <div className="flex-1 overflow-y-auto space-y-2">
                          {gemsInWarehouse.map((gem) => (
                            <button
                              key={gem.uid}
                              type="button"
                              onClick={() =>
                                handleSocketGem(inlayTarget.slot, inlayTarget.socketIdx, gem)
                              }
                              className="w-full min-h-[56px] rounded-xl bg-[#120c08] border border-purple-500/35 p-2.5 flex items-center gap-3 text-left"
                            >
                              <ItemSvg templateId={gem.templateId} color={gem.color} size={32} />
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-bold text-amber-100">
                                  {gem.name} · {RARITY_INFO[gem.rarity].label}
                                </div>
                                <div className="text-[11px] text-purple-300">
                                  {describeGemEffect(gem.gemKind, gem.rarity)}
                                </div>
                              </div>
                              <span className="text-xs font-semibold text-amber-300">Khảm</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Modal Quản lý vật phẩm đang đặt trong Tủ kính (Lấy ra / Bán / Lưu bộ sưu tập) */}
          {inspectedShowcaseItem && (
            <div className="absolute inset-0 z-40 bg-black/75 backdrop-blur-sm flex items-end">
              <div className="w-full rounded-t-3xl bg-[#1a120c] border-t border-amber-600/40 p-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] space-y-3">
                {(() => {
                  const sellPrice = computeSellPrice(inspectedShowcaseItem, game.market);
                  const isUnrecordedRelic =
                    inspectedShowcaseItem.category === 'relic' &&
                    !game.collectionRecord.includes(inspectedShowcaseItem.templateId);

                  return (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-12 h-12 rounded-xl bg-[#110b07] border border-amber-800/40 flex items-center justify-center shrink-0">
                            <ItemSvg
                              templateId={inspectedShowcaseItem.templateId}
                              color={inspectedShowcaseItem.color}
                              size={36}
                            />
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-display text-base font-bold text-amber-200 truncate">
                              {inspectedShowcaseItem.name}
                            </h3>
                            <p className="text-xs text-stone-400">
                              {RARITY_INFO[inspectedShowcaseItem.rarity].label} · Giá bán{' '}
                              {sellPrice} xu
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowcaseInspectUid(null)}
                          className="min-h-[48px] px-3 rounded-xl bg-stone-800 text-xs text-stone-200 shrink-0"
                        >
                          Đóng
                        </button>
                      </div>

                      <div className="space-y-2">
                        <button
                          type="button"
                          onClick={() => handleSellShowcaseItem(inspectedShowcaseItem.uid)}
                          className="w-full min-h-[50px] rounded-xl bg-amber-600 text-[#180f07] font-bold text-xs active:scale-[0.98] transition"
                        >
                          Bán Ngay (+{sellPrice} xu)
                        </button>

                        <button
                          type="button"
                          onClick={() => handleTakeFromShowcase(inspectedShowcaseItem.uid)}
                          className="w-full min-h-[50px] rounded-xl bg-[#271b11] border border-amber-600/40 text-amber-100 font-semibold text-xs active:scale-[0.98] transition"
                        >
                          Lấy Ra Kho (Để bán hoặc khảm — không nộp cống được)
                        </button>

                        {isUnrecordedRelic && (
                          <button
                            type="button"
                            onClick={() =>
                              handleRecordRelic(inspectedShowcaseItem.uid, 'showcase')
                            }
                            className="w-full min-h-[50px] rounded-xl bg-emerald-950/60 border border-emerald-500/50 text-emerald-200 font-semibold text-xs active:scale-[0.98] transition"
                          >
                            Lưu Vào Bộ Sưu Tập Vĩnh Viễn (Giải phóng ô Tủ)
                          </button>
                        )}
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Modal Luật chơi & Nút Chơi lại */}
          {showRules && (
            <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="w-full max-w-sm rounded-2xl bg-[#1a120c] border border-amber-700/45 p-4 space-y-3 max-h-[85%] overflow-y-auto">
                <div className="flex items-center justify-between border-b border-amber-900/30 pb-2">
                  <h3 className="font-display text-base font-bold text-amber-200">
                    Luật Chơi Hầm Sâu
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      setShowRules(false);
                      setShowResetConfirm(false);
                    }}
                    className="min-h-[48px] px-3 rounded-xl bg-stone-800 text-xs text-stone-200"
                  >
                    Đóng
                  </button>
                </div>

                <ul className="space-y-2 text-xs text-stone-300 leading-relaxed">
                  <li>
                    • <strong className="text-amber-100">Đào &amp; 2s Vô Hạn:</strong> Mỗi xẻng là 1
                    lượt xuống hầm. Đạt chuỗi 10 lần liên tiếp không sập (suýt sập được khiên cứu vẫn{' '}
                    <strong className="text-amber-200">giữ nguyên chuỗi</strong>) sẽ kích hoạt 2 giây
                    đào vô hạn!
                  </li>
                  <li>
                    • <strong className="text-amber-100">Quản lý túi khi đào:</strong> Bấm vào túi
                    hoặc vật phẩm bất kỳ lúc nào (kể cả khi chưa đầy) để xem thuộc tính ngọc hoặc bỏ 1
                    hay nhiều món.
                  </li>
                  <li>
                    • <strong className="text-amber-100">Chợ &amp; Dụng cụ ván kế:</strong> Chỉ mua
                    thêm xẻng ở Chợ trong Xưởng (áp dụng cho ngày kế tiếp), cùng Đồng Hồ Cát quay
                    ngược thời gian khi sập, Mìn phá đá, La Bàn &amp; Đèn Dầu lớn.
                  </li>
                  <li>
                    • <strong className="text-amber-100">Cống nạp theo ngày:</strong> Chỉ vật phẩm
                    đào được trong ngày hôm nay mới dùng để nộp cống. Ngọc đang khảm, ngọc mua ở
                    Chợ hoặc đồ tồn từ ngày trước được tính riêng để bán xu, khảm hoặc trưng bày.
                  </li>
                  <li>
                    • <strong className="text-amber-100">
                      Chiến dịch {GAME_CONFIG.CAMPAIGN_DAYS} ngày (+ Vô tận):
                    </strong>{' '}
                    {GAME_CONFIG.DAILY_TRIBUTES.join(' → ')} (sau đó tiếp tục mở rộng Vô tận).
                  </li>
                </ul>

                <div className="pt-2 border-t border-amber-900/30">
                  {!showResetConfirm ? (
                    <button
                      type="button"
                      onClick={() => setShowResetConfirm(true)}
                      className="w-full min-h-[48px] rounded-xl bg-rose-950/60 border border-rose-500/45 text-rose-200 font-semibold text-xs"
                    >
                      Chơi Lại Từ Đầu
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-rose-200 text-center">
                        Xóa tiến trình hiện tại và chơi lại từ Ngày 1?
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setShowResetConfirm(false)}
                          className="min-h-[48px] rounded-xl bg-stone-800 text-xs text-stone-200"
                        >
                          Hủy
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowRules(false);
                            handleRestartGame();
                          }}
                          className="min-h-[48px] rounded-xl bg-rose-700 text-xs font-bold text-white"
                        >
                          Xác nhận Chơi Lại
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </main>

        {/* Bảng phụ hiển thị trên màn hình rộng (Desktop) */}
        {DesktopSideLedger}
      </div>
    </div>
  );
}
