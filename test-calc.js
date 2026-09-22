const E = require('./calc-engine.js');

function fmt(n) { return '$' + Math.round(n).toLocaleString('en-US'); }

const base = {
  currentAge: 30, retirementAge: 65, filingStatus: 'single', workStartAge: 22,
  currentSalary: 75000, salaryGrowthRate: 3.5,
  traditionalBalance: 20000, traditionalContribPct: 6,
  employerMatchRate: 100, employerMatchCapPct: 4,
  rothBalance: 8000, rothContribPct: 4,
  taxableBalance: 5000, taxableContribPct: 2,
  esopBalance: 15000, esopContribPct: 6, esopDilutionRate: 3, esopGrowthRate: 7,
  expectedReturn: 10, inflationRate: 3,
  sex: 'male', deathAge: 84,
  ssClaimAge: null, // null => use recommendation
  trustSpendRate: 4,
};

console.log('=== Sanity: life expectancy table ===');
console.log('Male remaining LE at 65 (expect ~18.12):', E.remainingLifeExpectancy(65, 'male'));
console.log('Female remaining LE at 65 (expect ~20.66):', E.remainingLifeExpectancy(65, 'female'));
console.log('Male remaining LE at 40 (expect ~38.59):', E.remainingLifeExpectancy(40, 'male'));
console.log('Interpolated male LE at 42 (between 40 and 45):', E.remainingLifeExpectancy(42, 'male'));
console.log('defaultDeathAge(30, male) (expect ~30+47.5=78):', E.defaultDeathAge(30, 'male'));
console.log('defaultDeathAge(30, female) (expect ~30+52.08=82):', E.defaultDeathAge(30, 'female'));
console.log('defaultDeathAge(65, male) (expect ~65+18.12=83):', E.defaultDeathAge(65, 'male'));

console.log('\n=== Sanity: RMD ===');
console.log('rmdStartAge(1990) expect 75:', E.rmdStartAge(1990));
console.log('rmdStartAge(1955) expect 73:', E.rmdStartAge(1955));
console.log('rmdDivisor(73) expect 26.5:', E.rmdDivisor(73));
console.log('rmdDivisor(100) expect 6.4:', E.rmdDivisor(100));
console.log('rmdDivisor(105) extrapolated expect ~4.4:', E.rmdDivisor(105));

console.log('\n=== Full run: base case ===');
const r = E.computeResults(base);
console.log('Nominal balance at retirement:', fmt(r.nominalBalance));
console.log("Today's-$ balance at retirement:", fmt(r.realBalance));
console.log('SWR:', r.swr.toFixed(2)+'%', 'target annual portfolio spend (real):', fmt(r.grossWithdrawalReal));
console.log('SS base: birthYear', r.ssBase.birthYear, 'FRA yrs', r.ssBase.fraYears.toFixed(2), 'AIME', fmt(r.ssBase.aime), 'PIA@FRA/mo', fmt(r.ssBase.piaAtFRA), 'RMD start age', r.ssBase.rmdStartAge);
console.log('Recommended SS claim age:', r.recommendation.best);
console.log('Objective by claim age:');
r.recommendation.results.forEach(x => console.log('  age', x.claimAge, '->', fmt(x.objective)));
console.log('Using claim age:', r.ssClaimAge);
console.log('First retirement year row:', JSON.stringify(r.firstYear, (k,v)=>typeof v==='number'?Math.round(v):v, 2));
console.log('Number of retirement years simulated:', r.sim.rows.length, '(expect deathAge-retirementAge+1 = 84-65+1=20)');
console.log('Last retirement year row (at death):', JSON.stringify(r.sim.rows[r.sim.rows.length-1], (k,v)=>typeof v==='number'?Math.round(v):v, 2));

console.log('\n=== RMD kicks in check ===');
// find first row where age >= rmdAge and rmdTrad > 0
const rmdRow = r.sim.rows.find(row => row.rmdTrad > 0 || row.rmdEsop > 0);
console.log('First row with nonzero RMD:', rmdRow ? {age: rmdRow.age, rmdTrad: Math.round(rmdRow.rmdTrad), rmdEsop: Math.round(rmdRow.rmdEsop), extraFromRMD: Math.round(rmdRow.extraFromRMD)} : 'none found (retirement ended before RMD age)');

console.log('\n=== Trust simulation ===');
console.log('Balance at death (trust seed):', fmt(r.sim.rows[r.sim.rows.length-1].balTotal));
r.trust.forEach(row => console.log('  +'+row.yearsAfterDeath+'yr: balance', fmt(row.balance), 'distribution', fmt(row.distribution)));

console.log('\n=== Edge case: retire early (55), death at 90 -- long RMD-heavy horizon ===');
const early = Object.assign({}, base, {retirementAge:55, deathAge:90});
const r2 = E.computeResults(early);
console.log('Recommended SS claim age:', r2.recommendation.best, 'objectives:', r2.recommendation.results.map(x=>x.claimAge+':'+Math.round(x.objective)).join(', '));
console.log('Years simulated:', r2.sim.rows.length, '(expect 90-55+1=36)');
console.log('Final balance at death:', fmt(r2.sim.rows[r2.sim.rows.length-1].balTotal));
const negBal = r2.sim.rows.find(row => row.balTraditional<0 || row.balRoth<0 || row.balTaxable<0 || row.balEsop<0);
console.log('Any negative balances (should be none):', negBal ? JSON.stringify(negBal) : 'none -- OK');

console.log('\n=== Edge case: zero ESOP, zero taxable -- should not NaN ===');
const noEsop = Object.assign({}, base, {esopBalance:0, esopContribPct:0, taxableBalance:0, taxableContribPct:0});
const r3 = E.computeResults(noEsop);
const hasNaN = r3.sim.rows.some(row => Object.values(row).some(v => typeof v==='number' && isNaN(v)));
console.log('Any NaN in simulation (should be false):', hasNaN);
console.log('Final balance:', fmt(r3.sim.rows[r3.sim.rows.length-1].balTotal));

console.log('\n=== Edge case: money runs out before death (aggressive spend) ===');
const depleted = Object.assign({}, base, {retirementAge:50, deathAge:95, traditionalBalance:5000, rothBalance:2000, taxableBalance:1000, esopBalance:0, esopContribPct:0, traditionalContribPct:2, rothContribPct:1, taxableContribPct:0});
const r4 = E.computeResults(depleted);
const zeroRow = r4.sim.rows.find(row => row.balTotal <= 0.01);
console.log('First row balance hits ~0:', zeroRow ? zeroRow.age : 'never depletes');
const hasNaN4 = r4.sim.rows.some(row => Object.values(row).some(v => typeof v==='number' && isNaN(v)));
console.log('Any NaN after depletion (should be false):', hasNaN4);
console.log('Balance stays non-negative throughout:', r4.sim.rows.every(row => row.balTotal >= -0.01));

console.log('\n=== ESOP dilution sanity ===');
const esopOnly = Object.assign({}, base, {traditionalContribPct:0, rothContribPct:0, taxableContribPct:0, traditionalBalance:0, rothBalance:0, taxableBalance:0, esopBalance:0, esopContribPct:6, esopDilutionRate:3, esopGrowthRate:7, employerMatchRate:0});
const projEsop = E.projectBalances(esopOnly);
console.log('ESOP balance at retirement (35 yrs, 6% decaying 3%/yr, 7% growth):', fmt(projEsop.finalBalances.esop));
// with 0% dilution for comparison
const esopNoDilution = Object.assign({}, esopOnly, {esopDilutionRate:0});
const projEsopNoDilution = E.projectBalances(esopNoDilution);
console.log('Same but 0% dilution (should be higher):', fmt(projEsopNoDilution.finalBalances.esop));

console.log('\n=== ESOP leveraged loan payoff sanity ===');
// currentAge 30 in CONFIG.CURRENT_YEAR (2026) -> retires at 65 in 2061. Loan payoff at 2042
// falls at age 46 (i=16), well before retirement, so leveraged (6%) contributions should
// stop there and post-payoff (1%) should take over for the remaining working years.
const esopLeveraged = Object.assign({}, esopOnly, {esopLoanPayoffYear: 2042, esopPostPayoffContribPct: 1, esopDilutionRate: 0});
const projLeveraged = E.projectBalances(esopLeveraged);
const rowAtPayoff = projLeveraged.rows.find(r => r.year === 2042);
const rowJustBefore = projLeveraged.rows.find(r => r.year === 2041);
const rowJustAfter = projLeveraged.rows.find(r => r.year === 2043);
console.log('ESOP value, year before payoff (2041):', fmt(rowJustBefore.esop));
console.log('ESOP value, payoff year (2042, last leveraged contribution should have landed the prior year):', fmt(rowAtPayoff.esop));
console.log('ESOP value, year after payoff (2043):', fmt(rowJustAfter.esop));
console.log('Contribution jump ratio 2041->2042 vs 2042->2043 (post-payoff growth should be much slower):',
  ((rowAtPayoff.esop - rowJustBefore.esop) / (rowJustAfter.esop - rowAtPayoff.esop)).toFixed(2) + 'x');
// Sanity: no payoff year set at all should reproduce the original always-leveraged behavior exactly
const esopNoPayoffYear = Object.assign({}, esopOnly, {esopDilutionRate: 0});
delete esopNoPayoffYear.esopLoanPayoffYear;
const projNoPayoffYear = E.projectBalances(esopNoPayoffYear);
const alwaysLeveraged = Object.assign({}, esopOnly, {esopDilutionRate: 0, esopLoanPayoffYear: 9999, esopPostPayoffContribPct: 0});
const projAlwaysLeveraged = E.projectBalances(alwaysLeveraged);
console.log('Backward-compat check (no payoff year vs. payoff year far in future) match:',
  Math.abs(projNoPayoffYear.finalBalances.esop - projAlwaysLeveraged.finalBalances.esop) < 0.01 ? 'OK' : 'MISMATCH');

console.log('\n=== ESOP rolls into Traditional at retirement sanity ===');
// A retiree with a sizable ESOP and small Traditional balance: at retirement the two
// should merge into one Traditional bucket, with the ESOP bucket empty from then on.
const rollBase = Object.assign({}, base, {
  traditionalBalance: 10000, traditionalContribPct: 0, rothContribPct: 0, taxableContribPct: 0,
  esopBalance: 50000, esopContribPct: 8, esopDilutionRate: 0, esopGrowthRate: 7,
  employerMatchRate: 0, retirementAge: 65, deathAge: 90, withdrawalStrategy: 'proportional',
});
const rollProj = E.projectBalances(rollBase);
const rollSsBase = E.computeSocialSecurityBase(rollBase);
const rollSim = E.simulateRetirement(rollBase, 67, rollProj, rollSsBase);
console.log('ESOP + Traditional at retirement (should both be > 0 going in):',
  fmt(rollProj.finalBalances.esop), '/', fmt(rollProj.finalBalances.traditional));
console.log('First retirement-year ESOP withdrawal (expect 0, ESOP already rolled in):', fmt(rollSim.rows[0].withdrawalEsop));
const anyEsopWithdrawal = rollSim.rows.some(row => row.withdrawalEsop > 0.01 || row.rmdEsop > 0.01 || row.balEsop > 0.01);
console.log('No row ever draws from or holds an ESOP balance post-retirement:', anyEsopWithdrawal ? 'MISMATCH' : 'OK');
console.log('First-year Traditional withdrawal is nonzero (money did move into Traditional):', rollSim.rows[0].withdrawalTrad > 0 ? 'OK' : 'MISMATCH');
// Total real dollars at the retirement boundary should be conserved by the merge (no
// money created or destroyed, just relabeled from esop to traditional).
const totalBeforeMerge = (rollProj.finalBalances.traditional + rollProj.finalBalances.roth + rollProj.finalBalances.taxable + rollProj.finalBalances.esop + (rollProj.finalBalances.hsa||0));
const yearsToRet = rollBase.retirementAge - rollBase.currentAge;
const inflFactorRoll = Math.pow(1 + rollBase.inflationRate/100, yearsToRet);
const totalAfterMergeReal = rollSim.totalAtRetirementReal;
console.log('Total value conserved across the merge (real $ match):',
  Math.abs(totalBeforeMerge/inflFactorRoll - totalAfterMergeReal) < 1 ? 'OK' : 'MISMATCH: ' + (totalBeforeMerge/inflFactorRoll) + ' vs ' + totalAfterMergeReal);
// Post-retirement growth should follow the general portfolio return, not the ESOP rate.
// Invariance check: two scenarios with the SAME total balance at retirement, split
// differently between traditional/esop pre-merge but with expectedReturn and
// esopGrowthRate set far apart, should simulate IDENTICALLY once retired -- if the
// (now-irrelevant) esop rate were still leaking in post-retirement, they wouldn't match.
const splitA = Object.assign({}, base, {
  currentAge: 65, // no accumulation years, so finalBalances == the initial balances exactly --
                   // isolates the retirement-phase merge from any accumulation-phase growth drift
  traditionalBalance: 400000, traditionalContribPct: 0, rothContribPct: 0, taxableContribPct: 0,
  esopBalance: 0, esopContribPct: 0, employerMatchRate: 0,
  expectedReturn: 4, esopGrowthRate: 20, retirementAge: 65, deathAge: 80, withdrawalStrategy: 'proportional',
});
const splitB = Object.assign({}, splitA, { traditionalBalance: 100000, esopBalance: 300000 });
const projA = E.projectBalances(splitA), projB = E.projectBalances(splitB);
const ssBaseA = E.computeSocialSecurityBase(splitA), ssBaseB = E.computeSocialSecurityBase(splitB);
const simA = E.simulateRetirement(splitA, 67, projA, ssBaseA);
const simB = E.simulateRetirement(splitB, 67, projB, ssBaseB);
const lastA = simA.rows[simA.rows.length-1], lastB = simB.rows[simB.rows.length-1];
console.log('Same total at retirement, different traditional/esop split -- ending balance A:', fmt(lastA.balTotal), 'B:', fmt(lastB.balTotal));
console.log('Retirement simulations match regardless of pre-merge split (esop rate does not leak in):',
  Math.abs(lastA.balTotal - lastB.balTotal) < 1 ? 'OK' : 'MISMATCH');

console.log('\n=== State tax sanity ===');
const withState = Object.assign({}, base, {stateTaxRate: 4.45});
const withoutState = Object.assign({}, base, {stateTaxRate: 0});
const rWithState = E.computeResults(withState);
const rWithoutState = E.computeResults(withoutState);
console.log('First-year total tax with 4.45% state tax:', fmt(rWithState.firstYear.totalTax));
console.log('First-year total tax with no state tax:', fmt(rWithoutState.firstYear.totalTax));
console.log('State tax is additive (with > without):', rWithState.firstYear.totalTax > rWithoutState.firstYear.totalTax ? 'OK' : 'MISMATCH');

console.log('\n=== Withdrawal strategy sanity ===');
const proportional = Object.assign({}, base, {withdrawalStrategy: 'proportional', traditionalBalance: 500000, rothBalance: 500000, taxableBalance: 500000, esopBalance: 0});
const taxOptimized = Object.assign({}, base, {withdrawalStrategy: 'tax-optimized', traditionalBalance: 500000, rothBalance: 500000, taxableBalance: 500000, esopBalance: 0});
const rProp = E.computeResults(proportional);
const rOpt = E.computeResults(taxOptimized);
console.log('Proportional first-year: trad', fmt(rProp.firstYear.withdrawalTrad), 'roth', fmt(rProp.firstYear.withdrawalRoth), 'taxable', fmt(rProp.firstYear.withdrawalTaxable));
console.log('Tax-optimized first-year: trad', fmt(rOpt.firstYear.withdrawalTrad), 'roth', fmt(rOpt.firstYear.withdrawalRoth), 'taxable', fmt(rOpt.firstYear.withdrawalTaxable));
console.log('Tax-optimized draws taxable first, leaves Roth untouched while taxable+trad can cover spend (expect roth=0):', rOpt.firstYear.withdrawalRoth === 0 ? 'OK' : 'CHECK: ' + rOpt.firstYear.withdrawalRoth);
console.log('Proportional draws from all three simultaneously (expect roth > 0):', rProp.firstYear.withdrawalRoth > 0 ? 'OK' : 'MISMATCH');

console.log('\n=== HSA sanity ===');
const withHsa = Object.assign({}, base, {hsaBalance: 5000, hsaContribPct: 5, hsaCoverage: 'family'});
const projHsa = E.projectBalances(withHsa);
console.log('HSA balance at retirement (35 yrs, 5% of salary, family coverage):', fmt(projHsa.finalBalances.hsa));
console.log('HSA grows (final > initial):', projHsa.finalBalances.hsa > 5000 ? 'OK' : 'MISMATCH');
// contribution should be capped at the (inflation-grown) family HSA limit even at high hsaContribPct
const hsaCapped = Object.assign({}, base, {hsaBalance: 0, hsaContribPct: 90, hsaCoverage: 'self', currentSalary: 500000});
const projHsaCapped = E.projectBalances(hsaCapped);
const year1HsaGrowth = projHsaCapped.rows[1].hsa;
console.log('HSA contribution capped in year 1 (self-only limit $4,400, expect ~4400-4620 after growth):', fmt(year1HsaGrowth));
console.log('Cap enforced (year1 far below 90% of $500k salary = $450k):', year1HsaGrowth < 10000 ? 'OK' : 'MISMATCH');

console.log('\n=== Healthcare + HSA offset sanity ===');
const noHsaHealthcare = Object.assign({}, base, {healthcareAnnualCost: 7300, hsaBalance: 0, retirementAge: 65, deathAge: 70});
const rNoHsa = E.computeResults(noHsaHealthcare);
console.log('Healthcare cost at 65 (should equal the input, ~7300):', fmt(rNoHsa.firstYear.healthcareCost));
console.log('With zero HSA balance, full cost is a shortfall covered by other income:', fmt(rNoHsa.firstYear.healthcareShortfall));
console.log('HSA withdrawal with zero HSA balance (expect 0):', fmt(rNoHsa.firstYear.hsaWithdrawal));

const fullHsaHealthcare = Object.assign({}, base, {healthcareAnnualCost: 7300, hsaBalance: 500000, hsaContribPct: 0, retirementAge: 65, deathAge: 70});
const rFullHsa = E.computeResults(fullHsaHealthcare);
console.log('With a large HSA balance, shortfall should be 0:', rFullHsa.firstYear.healthcareShortfall === 0 ? 'OK' : 'MISMATCH: ' + rFullHsa.firstYear.healthcareShortfall);
console.log('HSA withdrawal covers the full cost:', Math.abs(rFullHsa.firstYear.hsaWithdrawal - rFullHsa.firstYear.healthcareCost) < 1 ? 'OK' : 'MISMATCH');

console.log('\n=== Real estate cash flow sanity ===');
const withRentals = Object.assign({}, base, {
  reAptRent: 3000, reAptExpenses: 1800,
  reCondoRent: 1800, reCondoExpenses: 1200,
  reSfhRent: 2500, reSfhExpenses: 1500,
});
console.log('Total annual rental cash flow (expect (3000-1800+1800-1200+2500-1500)*12 = 33600):', fmt(E.realEstateAnnualCashFlow(withRentals)));
const rRentals = E.computeResults(withRentals);
const rNoRentals = E.computeResults(base);
console.log('grossIncome with rentals > without:', rRentals.firstYear.grossIncome > rNoRentals.firstYear.grossIncome ? 'OK' : 'MISMATCH');
console.log('Difference matches annual cash flow:', Math.abs((rRentals.firstYear.grossIncome - rNoRentals.firstYear.grossIncome) - E.realEstateAnnualCashFlow(withRentals)) < 1 ? 'OK' : 'MISMATCH');
