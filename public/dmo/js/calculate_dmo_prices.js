// dmoCalc.js — single source of truth for DMO order financials.
// Pure function: give it the PDF inputs + live cost, get every derived figure.
// stampTax is a PDF-derived INPUT (not computed) for saved orders.
// The live sepet calculator, which has no PDF, estimates stampTax as basket*0.01517
// BEFORE calling this and passes the estimate in — the estimation lives there, not here.
function computeDmoFinancials({
  basket,            // total_amount_excl_vat (raw DMO basket, from PDF)
  tutarIndirimi = 0, // discount (from PDF)
  stampTax = 0,      // damga (from PDF for saved orders; estimated upstream for live calc)
  inokasBasket = 0,  // live cost: Σ last_purchase_price_tl × qty over non-gift items
  giftTotal = 0,     // live cost of gift items
}) {
  const b            = Number(basket) || 0;
  const disc         = Number(tutarIndirimi) || 0;
  const realBasket   = b - disc;

  const kdv          = realBasket * 0.20;
  const tevkifat     = kdv * 0.20;
  const gercekKdv    = kdv - tevkifat;
  const risturn      = realBasket * 0.01;
  const damga        = Number(stampTax) || 0;      // ← read, not computed
  const vergiler     = tevkifat + risturn + damga;

  const toplamGelir  = realBasket + gercekKdv;
  const toplamGider  = (Number(inokasBasket) || 0) + disc + vergiler + (Number(giftTotal) || 0);
  const netProfit    = toplamGelir - toplamGider;
  const profitPct    = toplamGelir > 0 ? (netProfit / toplamGelir) * 100 : 0;

  return {
    realBasket, kdv, tevkifat, gercekKdv, risturn, damga, vergiler,
    toplamGelir, toplamGider, netProfit, profitPct,
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { computeDmoFinancials };
if (typeof window !== 'undefined') window.DmoCalc = { computeDmoFinancials };