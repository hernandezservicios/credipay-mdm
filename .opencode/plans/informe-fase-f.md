# INFORME F15 — FASE F (Frontend Cobranza unificada → `/api/v1/loans`)

> Estado: **CERRADA** — gate F14 completo en verde y suite e2e nueva pasando.
> Contrato: Adenda v2.2 F1–F15. Esta fase NO avanzó a G hasta cerrar el informe.

---

## 1. Alcance

Unificar toda la cobranza del frontend sobre el endpoint `/api/v1/loans` (Fase E:
`loanService`, simulate, pay con idempotencia R13), aplicar las reglas F1–F13 en
toda la app, y cerrar con el gate de calidad F14 (Typecheck + ESLint + Build +
Playwright + Vitest).

## 2. Archivos NUEVOS de la Fase F

| Archivo | Rol |
|---|---|
| `src/components/CobranzaModal.tsx` | Cobro unificado por préstamo (F11): simulate → distribute → pay. Cero lógica financiera en React (F10). Llave idempotencia auto (R13). |
| `src/components/LoanDetailModal.tsx` | Detalle del préstamo: resumen + cuotas + timeline (`loan_events`, D25). |
| `src/components/ui/Badge.tsx` `Button.tsx` `EmptyState.tsx` `Pagination.tsx` `SearchInput.tsx` `Spinner.tsx` | Sistema de diseño (F2), reutilizado por la vista Préstamos. |
| `src/constants.ts` | `FIXED_PENALTY_AMOUNT = 200`, `CURRENCY_SYMBOL = 'RD$'`, `BUCKET_LABEL`, `STATUS_TONE`, métodos/bancos (F9 centralizado). |
| `src/utils/formatters.ts` | `formatCurrencyRD(value, withSymbol, symbol)` (F3), `formatDate`, `formatDateTime`, `toIsoDate` (F4). |
| `e2e/faseF.spec.ts` | Smoke read-only de la Fase F (4 tests). |
| `eslint.config.js` | Flat config: `no-unused-vars` (error), `react-hooks/set-state-in-effect` (warning, fetch-on-mount), ignores server/e2e/dist. |

## 3. Archivos MODIFICADOS (frontend)

| Archivo | Cambio Fase F |
|---|---|
| `src/App.tsx` | F-4: fuera `NewCreditModal`/`PaymentModal` (legacy), texto `onOpenPayment` de `InstallmentsModal`; se pasa `openWizardToken` a `LoansView`; F5 `formatDate` en renovación. |
| `src/components/LoansView.tsx` | Prop `openWizardToken`, `dedFmtDate` F4 en celdas, modales Cobrar/Detalle, botones Cobrar/Detalle. |
| `src/components/InstallmentsModal.tsx` | 'Cobrar desde Préstamos' → tab Préstamos; formato RD con `FIXED_PENALTY_AMOUNT`. |
| `src/components/{CollectionsView,CashView,LoansView,ReportsView,DashboardView,DashboardStats,ClientList,AiCobranzaModal,FinanceView,AnalyticsView,UsersView,SecurityModal}.tsx` | F3/F4: sustituir helpers locales (`money`/`fmtMoney`/`dateShort`/`formatPrice`/`toLocaleString`) por `formatCurrencyRD`/`formatDate`/`formatDateTime`. |
| `src/components/PlatformPortalView.tsx` `PlatformAdminView.tsx` `SaaSAvView.tsx` | Mismo sweep F3/F4 + `symbol` param para moneda SaaS. |
| `src/components/{Sidebar,Navbar}.tsx` `MdmActionDropdown.tsx` `MdmApiConfigModal.tsx` `InovaGuardDevicesView.tsx` | F13: limpieza props/imports muertos. |
| `src/services/api.ts` | F11: `loanService` + `apiPayLoan`/`apiSimulateLoanPayment`/`apiLoanDetail`; borrados `apiCreateCredit`, `apiPatchInstallment`, `apiCascadePayment`. |
| `package.json` | Deps dev ESLint + Playwright; `"lint": "eslint src"`. |

## 4. Archivos ELIMINADOS (legacy F4)

- `src/components/PaymentModal.tsx` (cobranza cascada legacy → eliminado)
- `src/components/NewCreditModal.tsx` (alta de crédito → ahora vía wizard de Préstamos)

## 5. Evidencia del gate F14

| Gate | Comando | Resultado |
|---|---|---|
| Typecheck | `tsc --noEmit` | **0 errores** |
| ESLint | `npm run lint` (`eslint src`) | **0 errors** · 26 warnings (pre-existentes, patrón fetch-on-mount `set-state-in-effect`/`exhaustive-deps` — aceptados) |
| Build | `npm run build` | **PASS** 7.2s · 1715 modules · `index-*.js` 595.59 kB (gzip 145.65 kB) · warning chunk>500 kB no bloqueante |
| Vitest (server) | `npm --prefix server test` | **8 files / 68 tests passed** |
| Playwright e2e | `npx playwright test e2e/faseF.spec.ts` | **4 / 4 passed** (31.3s) |

### Detalle de los 4 tests e2e (`e2e/faseF.spec.ts`)
1. Login + tab Préstamos carga listado desde API sin errores de consola.
2. Filtro de estados (`EN MORA` / `TODOS`) opera sobre la tabla.
3. Detalle del préstamo abre con timeline (API `loans/:id`).
4. Cobro **simulado**: montos + `Simular distribución` muestra Distribución propuesta + Llave de idempotencia (R13); `Cancelar` sin confirmar → **BD intacta** (sin pagos nuevos/`payment_transactions`).

## 6. Decisiones y desviaciones
- **F3/F4 applicados en TODA la app** (no solo a préstamos), aprobado por el usuario.
- **Legacy eliminado en F** (PaymentModal/NewCreditModal + `apiCascadePayment`/`apiCreateCredit`), aprobado por el usuario.
- **`formatCurrencyRD` recibe `symbol`** para soportar US$ en vistas SaaS/Portal sin duplicar helpers.
- **Hash bcrypt en migración `0007_credenciales_demo.sql` verificado CORRECTO** (decodes `Fase2Test2026!`, `7xs8G8GJrTze9S`, `NuevaClave2026!`). El fallo de e2e era de la **BD dev re-seedeada** (usuarios demo con `tenant_id NULL` + contraseñas aleatorias) — se corrigió en la BD dev (tenant `alpha` + passwords demo) y no requiere cambiar la migración.
- **Nota de mantenimiento**: si se restaura desde dump, re-ejecutar la reparación de demo users para los e2e (ver `e2e/faseF.spec.ts` ADMON var).

## 7. Cierre
Fase F **cerrada y lista para avanzar a G** con el contrato F1–F15 cumplido.
Fecha del cierre: 2026-08-06.