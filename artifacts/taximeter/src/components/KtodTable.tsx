import { KtodCoefficients, KtodMode, TARIFFS, TariffType } from '../types';
import { calculatePrice } from '../utils/ktod';

interface Props {
  coefs: KtodCoefficients;
  activeKtod: number;
  ktodMode: KtodMode;
  ktodLabel: string;
  manualKtodIndex: number;
  onCoefsChange: (c: KtodCoefficients) => void;
  onKtodModeChange: (m: KtodMode) => void;
  onManualKtodChange: (idx: number) => void;
  tariff: TariffType;
  distanceMeters: number;
  elapsedSeconds: number;
}

interface Row {
  label: string;
  key: keyof KtodCoefficients;
  idx: number;
}

const ROWS: Row[] = [
  { label: 'Будни день (06:00–22:00)', key: 'weekdayDay', idx: 0 },
  { label: 'Будни ночь (22:00–06:00)', key: 'weekdayNight', idx: 1 },
  { label: 'Выходные день (09:00–22:00)', key: 'weekendDay', idx: 2 },
  { label: 'Выходные ночь (22:00–09:00)', key: 'weekendNight', idx: 3 },
];

export default function KtodTable({
  coefs, activeKtod, ktodMode, ktodLabel, manualKtodIndex,
  onCoefsChange, onKtodModeChange, onManualKtodChange, tariff, distanceMeters, elapsedSeconds
}: Props) {
  const t = TARIFFS[tariff];

  const updateCoef = (key: keyof KtodCoefficients, val: number) => {
    onCoefsChange({ ...coefs, [key]: val });
  };

  const testPrice = (ktod: number) => calculatePrice(t.S, t.rd, t.rt, distanceMeters, elapsedSeconds, ktod);

  return (
    <div className="card-neon p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="section-title">Коэффициенты Ktod</span>
        <div className="flex gap-2 items-center">
          <span className="text-xs" style={{ color: 'hsl(180 30% 50%)' }}>Режим:</span>
          <button
            className={`text-xs px-2 py-1 rounded ${ktodMode === 'auto' ? 'btn-neon-cyan' : ''}`}
            style={ktodMode !== 'auto' ? { background: 'hsl(222 47% 12%)', border: '1px solid hsl(195 100% 15%)', color: 'hsl(180 30% 50%)', borderRadius: '4px' } : {}}
            onClick={() => onKtodModeChange('auto')}
          >Авто</button>
          <button
            className={`text-xs px-2 py-1 rounded ${ktodMode === 'manual' ? 'btn-neon-purple' : ''}`}
            style={ktodMode !== 'manual' ? { background: 'hsl(222 47% 12%)', border: '1px solid hsl(195 100% 15%)', color: 'hsl(180 30% 50%)', borderRadius: '4px' } : {}}
            onClick={() => onKtodModeChange('manual')}
          >Вручную</button>
        </div>
      </div>

      <div className="text-xs flex items-center gap-2">
        <span style={{ color: 'hsl(180 30% 50%)' }}>Текущий режим:</span>
        <span className="neon-cyan font-semibold">{ktodMode === 'auto' ? ktodLabel : 'Ручной выбор'}</span>
        <span style={{ color: 'hsl(180 30% 50%)' }}>→ Ktod =</span>
        <span className="neon-yellow font-bold">{activeKtod.toFixed(1)}</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid hsl(195 100% 15%)' }}>
              <th className="text-left py-1 pr-2" style={{ color: 'hsl(180 30% 45%)' }}>Период</th>
              <th className="text-center py-1 px-2" style={{ color: 'hsl(180 30% 45%)' }}>Ktod</th>
              <th className="text-center py-1 px-2" style={{ color: 'hsl(180 30% 45%)' }}>Тест-цена ₽</th>
              {ktodMode === 'manual' && (
                <th className="text-center py-1" style={{ color: 'hsl(180 30% 45%)' }}>Выбрать</th>
              )}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => {
              const val = coefs[row.key];
              const isActive = ktodMode === 'auto'
                ? false
                : manualKtodIndex === row.idx;
              return (
                <tr
                  key={row.key}
                  style={{
                    borderBottom: '1px solid hsl(195 100% 10%)',
                    background: isActive ? 'hsl(270 80% 10%)' : 'transparent',
                  }}
                >
                  <td className="py-1.5 pr-2" style={{ color: isActive ? 'hsl(270 100% 75%)' : 'hsl(180 30% 60%)' }}>
                    {row.label}
                  </td>
                  <td className="py-1.5 px-2 text-center">
                    <input
                      type="number"
                      step="0.1"
                      min="0.5"
                      max="5"
                      value={val}
                      onChange={(e) => updateCoef(row.key, parseFloat(e.target.value) || val)}
                      style={{ width: '56px', textAlign: 'center' }}
                    />
                  </td>
                  <td className="py-1.5 px-2 text-center neon-yellow font-mono">
                    {testPrice(val).toFixed(0)}
                  </td>
                  {ktodMode === 'manual' && (
                    <td className="py-1.5 text-center">
                      <button
                        onClick={() => onManualKtodChange(row.idx)}
                        className="text-xs px-2 py-0.5 rounded"
                        style={isActive
                          ? { background: 'hsl(270 80% 25%)', border: '1px solid hsl(270 100% 55%)', color: 'hsl(270 100% 75%)' }
                          : { background: 'hsl(222 47% 12%)', border: '1px solid hsl(195 100% 15%)', color: 'hsl(180 30% 50%)' }
                        }
                      >
                        {isActive ? '✓ Выбран' : 'Выбрать'}
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="text-xs" style={{ color: 'hsl(180 30% 40%)' }}>
        Формула: P = S({t.S}) + D(км)×{t.rd} + T(мин)×{t.rt}×Ktod({activeKtod.toFixed(1)})
      </div>
    </div>
  );
}
