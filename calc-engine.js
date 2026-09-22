// ---- Retirement calculator core engine (tested standalone before embedding) ----

const CONFIG = {
  CURRENT_YEAR: 2026,
  SS_BEND1: 1226,        // 2026 monthly AIME first bend point
  SS_BEND2: 7391,        // 2026 monthly AIME second bend point
  SS_WAGE_BASE: 184500,  // 2026 Social Security taxable maximum earnings
  MND_CPI_FACTOR: 2.13,  // cumulative CPI multiplier, 1996 -> 2026 (in2013dollars.com / BLS CPI-U)
  MND_YEAR: 1996,        // publication year of "The Millionaire Next Door"
  ELECTIVE_BASE_401K: 24500,
  ELECTIVE_BASE_IRA: 7500,
  CATCHUP_401K_50: 8000,
  CATCHUP_401K_60_63: 11250,
  CATCHUP_IRA_50: 1100,
  // IRS Uniform Lifetime Table divisors (unchanged since 2022), ages 72-100
  RMD_TABLE: {72:27.4,73:26.5,74:25.5,75:24.6,76:23.7,77:22.9,78:22.0,79:21.1,80:20.2,81:19.4,
    82:18.5,83:17.7,84:16.8,85:16.0,86:15.2,87:14.4,88:13.7,89:12.9,90:12.2,91:11.5,
    92:10.8,93:10.1,94:9.5,95:8.9,96:8.4,97:7.8,98:7.3,99:6.8,100:6.4},
  // SSA 2023 Period Life Table (used in the 2026 OASDI Trustees Report), remaining
  // life expectancy in years by exact current age and sex.
  LE_AGES: [18,20,22,25,30,35,40,45,50,55,60,65,70,75,80,85,90],
  LE_MALE:   [58.56,56.69,54.83,52.06,47.50,43.02,38.59,34.21,29.90,25.73,21.79,18.12,14.66,11.42,8.50,6.04,4.11],
  LE_FEMALE: [63.69,61.74,59.80,56.90,52.08,47.34,42.64,38.01,33.45,29.01,24.73,20.66,16.76,13.10,9.82,7.02,4.80],
  // State income tax: modeled as a single flat rate applied on top of federal, since
  // that's how Utah (this tool's default) actually works -- a flat rate on both
  // ordinary income and capital gains (Utah has no preferential capital-gains rate).
  // Default sourced from the Tax Foundation, effective 1/1/2026. Editable in the UI
  // for anyone in a different state; this tool doesn't model progressive state
  // brackets or state-specific credits/deductions.
  UTAH_FLAT_TAX_RATE: 4.45,
  // 2026 IRS HSA contribution limits (self-only / family) and the 55+ catch-up,
  // held constant in these dollars and then grown with inflation year over year in
  // the projection, matching how the IRS actually adjusts these limits annually.
  HSA_LIMIT_SELF: 4400,
  HSA_LIMIT_FAMILY: 8750,
  HSA_CATCHUP_55: 1000,
  // Average annual retirement healthcare cost at age 65, today's dollars, per person.
  // Derived from the Milliman 2026 Retiree Health Cost Index's lifetime cost figures
  // (a 65-year-old's projected lifetime Original Medicare + Medigap Plan G + Part D
  // spend, back-solved to an equivalent first-year cost under Milliman's own 4.8%
  // medical trend assumption). Milliman's data shows this starting annual figure is
  // very similar for men and women -- the higher female LIFETIME total is almost
  // entirely a function of living longer (already reflected in this tool's
  // sex-specific life-expectancy default), not a higher annual rate -- so this tool
  // uses one figure for both sexes rather than fabricating a gender split the
  // underlying data doesn't really support.
  HEALTHCARE_BASE_ANNUAL_AGE65: 7300,
  // Milliman's projected medical trend: nominal annual healthcare cost growth,
  // distinct from (and higher than) general inflation.
  HEALTHCARE_MEDICAL_TREND: 4.8,
};

function fraMonths(birthYear) {
  if (birthYear <= 1954) return 66 * 12;
  if (birthYear >= 1960) return 67 * 12;
  const table = { 1955: 66*12+2, 1956: 66*12+4, 1957: 66*12+6, 1958: 66*12+8, 1959: 66*12+10 };
  return table[birthYear];
}

// SECURE 2.0: RMDs start at 73 for those born 1951-1959, 75 for 1960+.
function rmdStartAge(birthYear) {
  return birthYear >= 1960 ? 75 : 73;
}

function rmdDivisor(age) {
  const t = CONFIG.RMD_TABLE;
  if (t[age] != null) return t[age];
  if (age > 100) return Math.max(1.0, 6.4 - (age - 100) * 0.4); // gentle extrapolation past the published table
  return t[72]; // below 72, RMDs don't apply -- caller guards this
}

function remainingLifeExpectancy(age, sex) {
  const ages = CONFIG.LE_AGES;
  const table = sex === 'female' ? CONFIG.LE_FEMALE : CONFIG.LE_MALE;
  if (age <= ages[0]) return table[0];
  const n = ages.length;
  if (age >= ages[n-1]) {
    const slope = (table[n-1] - table[n-2]) / (ages[n-1] - ages[n-2]);
    return Math.max(1, table[n-1] + slope * (age - ages[n-1]));
  }
  for (let i = 0; i < n - 1; i++) {
    if (age >= ages[i] && age <= ages[i+1]) {
      const frac = (age - ages[i]) / (ages[i+1] - ages[i]);
      return table[i] + frac * (table[i+1] - table[i]);
    }
  }
  return table[n-1];
}

function defaultDeathAge(currentAge, sex) {
  return Math.round(currentAge + remainingLifeExpectancy(currentAge, sex));
}

function taxTables(filingStatus) {
  if (filingStatus === 'mfj') {
    return {
      stdDeduction: 32200,
      brackets: [[0,.10],[24800,.12],[100800,.22],[211400,.24],[403550,.32],[512450,.35],[768700,.37]],
      ltcg: { zero: 98900, fifteen: 613700 },
      ssThresholds: { t1: 32000, t2: 44000 },
    };
  }
  return {
    stdDeduction: 16100,
    brackets: [[0,.10],[12400,.12],[50400,.22],[105700,.24],[201775,.32],[256225,.35],[640600,.37]],
    ltcg: { zero: 49450, fifteen: 545500 },
    ssThresholds: { t1: 25000, t2: 34000 },
  };
}

function progressiveTax(taxableIncome, brackets) {
  if (taxableIncome <= 0) return 0;
  let tax = 0;
  for (let i = 0; i < brackets.length; i++) {
    const [start, rate] = brackets[i];
    const next = i + 1 < brackets.length ? brackets[i+1][0] : Infinity;
    if (taxableIncome > start) {
      tax += (Math.min(taxableIncome, next) - start) * rate;
    } else break;
  }
  return tax;
}

function ltcgTax(ordinaryTaxableIncome, gainAmount, ltcg) {
  if (gainAmount <= 0) return 0;
  let remaining = gainAmount, tax = 0, floor = Math.max(0, ordinaryTaxableIncome);
  const zeroRoom = Math.max(0, ltcg.zero - floor);
  const zeroUsed = Math.min(remaining, zeroRoom);
  remaining -= zeroUsed; floor += zeroUsed;
  const fifteenRoom = Math.max(0, ltcg.fifteen - floor);
  const fifteenUsed = Math.min(remaining, fifteenRoom);
  tax += fifteenUsed * 0.15;
  remaining -= fifteenUsed; floor += fifteenUsed;
  tax += remaining * 0.20;
  return tax;
}

function taxableSocialSecurity(ssAnnual, otherOrdinaryIncome, thresholds) {
  if (ssAnnual <= 0) return 0;
  const combined = otherOrdinaryIncome + ssAnnual * 0.5;
  if (combined <= thresholds.t1) return 0;
  if (combined <= thresholds.t2) {
    return Math.min(0.5 * ssAnnual, 0.5 * (combined - thresholds.t1));
  }
  const tier1 = Math.min(0.5 * (thresholds.t2 - thresholds.t1), 0.5 * ssAnnual);
  const tier2 = 0.85 * (combined - thresholds.t2);
  return Math.min(0.85 * ssAnnual, tier1 + tier2);
}

function electiveCapForAge(age) {
  let catchup401k = 0, catchupIra = 0;
  if (age >= 60 && age <= 63) { catchup401k = CONFIG.CATCHUP_401K_60_63; catchupIra = CONFIG.CATCHUP_IRA_50; }
  else if (age >= 50) { catchup401k = CONFIG.CATCHUP_401K_50; catchupIra = CONFIG.CATCHUP_IRA_50; }
  return CONFIG.ELECTIVE_BASE_401K + CONFIG.ELECTIVE_BASE_IRA + catchup401k + catchupIra;
}

function swrForAge(retirementAge) {
  const swr = 4.0 + 0.10 * (retirementAge - 65);
  return Math.min(6.0, Math.max(2.5, swr));
}

function pIAFromAIME(aime) {
  const { SS_BEND1: b1, SS_BEND2: b2 } = CONFIG;
  if (aime <= b1) return aime * 0.90;
  if (aime <= b2) return b1 * 0.90 + (aime - b1) * 0.32;
  return b1 * 0.90 + (b2 - b1) * 0.32 + (aime - b2) * 0.15;
}

function adjustPIAForClaimAge(piaMonthly, claimAge, fraMo) {
  const claimMonths = Math.round(claimAge * 12);
  const diff = claimMonths - fraMo;
  if (diff < 0) {
    const monthsEarly = -diff;
    const first36 = Math.min(36, monthsEarly);
    const rest = Math.max(0, monthsEarly - 36);
    const reduction = first36 * (5/9/100) + rest * (5/12/100);
    return piaMonthly * (1 - reduction);
  } else if (diff > 0) {
    const capMonths = 70 * 12 - fraMo;
    const monthsLate = Math.min(diff, capMonths);
    const increase = monthsLate * (2/3/100);
    return piaMonthly * (1 + increase);
  }
  return piaMonthly;
}

// ---- Accumulation phase: current age -> retirement age ----
function projectBalances(inputs) {
  const years = inputs.retirementAge - inputs.currentAge;
  const r = inputs.expectedReturn / 100;
  const esopR = inputs.esopGrowthRate / 100;
  let salary = inputs.currentSalary;
  let bal = { traditional: inputs.traditionalBalance, roth: inputs.rothBalance, taxable: inputs.taxableBalance, esop: inputs.esopBalance || 0, hsa: inputs.hsaBalance || 0 };
  let taxableBasis = inputs.taxableBalance;

  const nominalSalaryByAge = {};
  nominalSalaryByAge[inputs.currentAge] = salary;

  const rows = [{
    age: inputs.currentAge, year: CONFIG.CURRENT_YEAR, salary,
    traditional: bal.traditional, roth: bal.roth, taxable: bal.taxable, esop: bal.esop, hsa: bal.hsa,
    total: bal.traditional + bal.roth + bal.taxable + bal.esop + bal.hsa,
  }];

  for (let i = 0; i < years; i++) {
    const age = inputs.currentAge + i;
    const cap = electiveCapForAge(age);
    let employeeTraditional = salary * inputs.traditionalContribPct / 100;
    let employeeRoth = salary * inputs.rothContribPct / 100;
    const totalElective = employeeTraditional + employeeRoth;
    if (totalElective > cap && totalElective > 0) {
      const scale = cap / totalElective;
      employeeTraditional *= scale;
      employeeRoth *= scale;
    }
    const combinedContribPct = inputs.traditionalContribPct + inputs.rothContribPct;
    const matchedPct = Math.min(combinedContribPct, inputs.employerMatchCapPct);
    const employerMatch = salary * matchedPct / 100 * (inputs.employerMatchRate / 100);
    const taxableContrib = salary * inputs.taxableContribPct / 100;

    // ESOP: many ESOPs (this one included) are leveraged -- the trust borrowed money
    // to buy shares up front, and each loan payment releases more shares from a
    // suspense account to be allocated to participants. That means the contribution
    // rate isn't a smooth decay to zero; it runs at roughly its current pace until
    // the loan is paid off, then drops to whatever smaller non-leveraged rate (if
    // any) continues afterward. esopLoanPayoffYear (year, e.g. 2042) is the calendar
    // year the leveraged rate stops and esopPostPayoffContribPct takes over; if
    // esopLoanPayoffYear is unset, the leveraged rate is simply assumed to continue
    // indefinitely (previous behavior). Whichever rate applies still decays by
    // esopDilutionRate%/yr, since headcount growth dilutes both leveraged and
    // non-leveraged pools alike -- see methodology.
    const currentYear = CONFIG.CURRENT_YEAR + i;
    const esopBaseContribPct = (inputs.esopLoanPayoffYear && currentYear >= inputs.esopLoanPayoffYear)
      ? (inputs.esopPostPayoffContribPct || 0)
      : (inputs.esopContribPct || 0);
    const esopContribPct = esopBaseContribPct * Math.pow(1 - (inputs.esopDilutionRate || 0) / 100, i);
    const esopContrib = salary * esopContribPct / 100;

    // HSA: triple-tax-advantaged (pre-tax in, tax-free growth, tax-free out for
    // qualified medical expenses). Capped at the IRS self-only/family limit plus the
    // 55+ catch-up, with the cap itself grown with inflation to mirror how the IRS
    // actually indexes it each year.
    const hsaCapBase = (inputs.hsaCoverage === 'family' ? CONFIG.HSA_LIMIT_FAMILY : CONFIG.HSA_LIMIT_SELF) + (age >= 55 ? CONFIG.HSA_CATCHUP_55 : 0);
    const hsaCap = hsaCapBase * Math.pow(1 + inputs.inflationRate / 100, i);
    const hsaContrib = Math.min(salary * (inputs.hsaContribPct || 0) / 100, hsaCap);

    bal.traditional = (bal.traditional + employeeTraditional + employerMatch) * (1 + r);
    bal.roth = (bal.roth + employeeRoth) * (1 + r);
    bal.taxable = (bal.taxable + taxableContrib) * (1 + r);
    bal.esop = (bal.esop + esopContrib) * (1 + esopR);
    bal.hsa = (bal.hsa + hsaContrib) * (1 + r);
    taxableBasis += taxableContrib;

    salary *= (1 + inputs.salaryGrowthRate / 100);
    const nextAge = age + 1;
    nominalSalaryByAge[nextAge] = salary;

    rows.push({
      age: nextAge, year: CONFIG.CURRENT_YEAR + i + 1, salary,
      traditional: bal.traditional, roth: bal.roth, taxable: bal.taxable, esop: bal.esop, hsa: bal.hsa,
      total: bal.traditional + bal.roth + bal.taxable + bal.esop + bal.hsa,
    });
  }

  return { rows, finalBalances: bal, taxableBasis, nominalSalaryByAge, years };
}

function proxyEarningsHistory(inputs) {
  const realGrowth = (1 + inputs.salaryGrowthRate / 100) / (1 + inputs.inflationRate / 100) - 1;
  const history = {};
  history[inputs.currentAge] = inputs.currentSalary;
  let s = inputs.currentSalary;
  for (let a = inputs.currentAge - 1; a >= inputs.workStartAge; a--) {
    s = s / (1 + realGrowth);
    history[a] = s;
  }
  s = inputs.currentSalary;
  for (let a = inputs.currentAge + 1; a < inputs.retirementAge; a++) {
    s = s * (1 + realGrowth);
    history[a] = s;
  }
  return history;
}

// Rental real estate: three separate categories (apartments, townhouse/condo, single-
// family) since they tend to have different rent, expense, and financing profiles.
// Each category's monthly rent and monthly expenses are entered as totals across all
// units in that category (not per-unit), so cash flow is simply rent minus expenses --
// unit count and average size are informational context, not part of the math. The
// mortgage payment is assumed to already be inside "expenses" (as instructed), so this
// tool does not attempt to model the cash-flow jump when a mortgage is paid off partway
// through the projection -- see methodology. Net cash flow is held constant in today's
// (real) dollars for the whole projection, consistent with how every other "real"
// figure in this tool works.
function realEstateAnnualCashFlow(inputs) {
  const categories = ['reApt', 'reCondo', 'reSfh'];
  return categories.reduce((total, prefix) => {
    const rent = inputs[prefix + 'Rent'] || 0;
    const expenses = inputs[prefix + 'Expenses'] || 0;
    return total + (rent - expenses) * 12;
  }, 0);
}

// Claim-age-independent Social Security base: birth year, FRA, AIME, PIA at FRA.
function computeSocialSecurityBase(inputs) {
  const birthYear = CONFIG.CURRENT_YEAR - inputs.currentAge;
  const fraMo = fraMonths(birthYear);
  const history = proxyEarningsHistory(inputs);
  const earnings = [];
  for (let a = inputs.workStartAge; a < inputs.retirementAge; a++) {
    earnings.push(Math.min(history[a] || 0, CONFIG.SS_WAGE_BASE));
  }
  const top35 = earnings.slice().sort((a, b) => b - a).slice(0, 35);
  while (top35.length < 35) top35.push(0);
  const sum = top35.reduce((a, b) => a + b, 0);
  const aime = sum / 420;
  const piaAtFRA = pIAFromAIME(aime);
  return { birthYear, fraMonths: fraMo, fraYears: fraMo / 12, aime, piaAtFRA, rmdStartAge: rmdStartAge(birthYear) };
}

function ssAnnualForClaimAge(ssBase, claimAge) {
  const adjustedMonthly = adjustPIAForClaimAge(ssBase.piaAtFRA, claimAge, ssBase.fraMonths);
  return adjustedMonthly * 12;
}

// Splits a spending need across Traditional/Roth/Taxable/ESOP under one of two
// strategies. "proportional" pulls from each bucket in proportion to its share of the
// total balance (simple, but not tax-efficient). "tax-optimized" fills the need in a
// conventional tax-efficient order: Taxable first (preferential/no gains-only tax,
// preserves tax-deferred and tax-free growth longer), then Traditional+ESOP together
// (both ordinary income, split pro-rata between the two since taxes don't distinguish
// them), then Roth last (grows tax-free longest and has no RMDs, so it's the best
// bucket to leave until the end). Either way, RMDs are applied as a hard floor
// afterward by the caller -- this only decides the pre-RMD "desired" split.
function splitWithdrawal(bal, need, strategy) {
  if (strategy === 'tax-optimized') {
    let remaining = need;
    const desiredTax = Math.min(bal.taxable, remaining); remaining -= desiredTax;
    const ordinaryPool = bal.traditional + bal.esop;
    const tradShareOfOrdinary = ordinaryPool > 0 ? bal.traditional / ordinaryPool : 0;
    const ordinaryDraw = Math.min(ordinaryPool, remaining); remaining -= ordinaryDraw;
    const desiredTrad = ordinaryDraw * tradShareOfOrdinary;
    const desiredEsop = ordinaryDraw * (1 - tradShareOfOrdinary);
    const desiredRoth = Math.min(bal.roth, remaining);
    return { desiredTrad, desiredRoth, desiredTax, desiredEsop };
  }
  const totalBal = bal.traditional + bal.roth + bal.taxable + bal.esop;
  const shareTrad = totalBal > 0 ? bal.traditional / totalBal : 0;
  const shareRoth = totalBal > 0 ? bal.roth / totalBal : 0;
  const shareTax = totalBal > 0 ? bal.taxable / totalBal : 0;
  const shareEsop = totalBal > 0 ? bal.esop / totalBal : 0;
  return {
    desiredTrad: Math.min(bal.traditional, need * shareTrad),
    desiredRoth: Math.min(bal.roth, need * shareRoth),
    desiredTax: Math.min(bal.taxable, need * shareTax),
    desiredEsop: Math.min(bal.esop, need * shareEsop),
  };
}

// ---- Decumulation phase: retirement age -> death age, year by year, real (today's) dollars ----
function simulateRetirement(inputs, ssClaimAge, proj, ssBase) {
  const yearsToRetirement = inputs.retirementAge - inputs.currentAge;
  const inflFactor = Math.pow(1 + inputs.inflationRate / 100, yearsToRetirement);
  const realReturn = (1 + inputs.expectedReturn / 100) / (1 + inputs.inflationRate / 100) - 1;
  const realEsopReturn = (1 + inputs.esopGrowthRate / 100) / (1 + inputs.inflationRate / 100) - 1;
  // Medical costs are assumed to grow faster than general inflation (Milliman's 4.8%
  // nominal medical trend vs. your own inflation assumption) -- this is the excess,
  // real growth rate on top of general inflation, applied from age 65 (the anchor age
  // the base cost figure is sourced at).
  const realMedicalTrend = (1 + CONFIG.HEALTHCARE_MEDICAL_TREND / 100) / (1 + inputs.inflationRate / 100) - 1;
  const rentalIncomeReal = realEstateAnnualCashFlow(inputs);

  // At retirement, this tool assumes the ESOP balance is rolled over into a Traditional
  // IRA rather than taken as a taxable lump-sum distribution -- the tax-smart move,
  // since a rollover defers ordinary income tax exactly the way a 401(k) rollover does
  // (a distribution instead would owe ordinary tax on the whole balance immediately).
  // Practically, that means: the dollars move from the "esop" bucket into "traditional"
  // in one step at the retirement boundary, the ESOP bucket is empty for the rest of the
  // simulation, and from here on that money grows at the general portfolio return
  // (expectedReturn) rather than the ESOP-specific company-stock rate (esopGrowthRate)
  // -- consistent with rolling into a normal, diversified IRA rather than staying
  // concentrated in employer stock. This does not model Net Unrealized Appreciation
  // (NUA), an alternative strategy where taking an in-kind stock distribution instead of
  // rolling over can convert some of the gain to capital-gains tax -- see methodology.
  let bal = {
    traditional: (proj.finalBalances.traditional + proj.finalBalances.esop) / inflFactor,
    roth: proj.finalBalances.roth / inflFactor,
    taxable: proj.finalBalances.taxable / inflFactor,
    esop: 0,
    hsa: (proj.finalBalances.hsa || 0) / inflFactor,
  };
  const totalAtRetirementReal = bal.traditional + bal.roth + bal.taxable + bal.esop;
  const swr = swrForAge(inputs.retirementAge);
  const targetSpendReal = totalAtRetirementReal * swr / 100;

  const taxableBasisReal = proj.taxableBasis / inflFactor;
  const gainFraction = bal.taxable > 0 ? Math.max(0, Math.min(1, 1 - taxableBasisReal / bal.taxable)) : 0;

  const ssAnnualReal = ssAnnualForClaimAge(ssBase, ssClaimAge);
  const tt = taxTables(inputs.filingStatus);
  const rmdAge = ssBase.rmdStartAge;
  const stateTaxRate = (inputs.stateTaxRate || 0) / 100;
  const strategy = inputs.withdrawalStrategy === 'tax-optimized' ? 'tax-optimized' : 'proportional';

  const rows = [];
  for (let age = inputs.retirementAge; age <= inputs.deathAge; age++) {
    // Healthcare cost this year, in today's dollars: base figure (entered at age 65)
    // compounded by the excess medical trend for every year above/below 65. Costs
    // before 65 (pre-Medicare) are likely understated by this formula in reality --
    // see methodology.
    const healthcareCostReal = Math.max(0, (inputs.healthcareAnnualCost || 0) * Math.pow(1 + realMedicalTrend, age - 65));
    const hsaWithdrawal = Math.min(bal.hsa, healthcareCostReal);
    const healthcareShortfall = healthcareCostReal - hsaWithdrawal;

    const totalSpendNeed = targetSpendReal + healthcareShortfall;
    const desired = splitWithdrawal(bal, totalSpendNeed, strategy);
    const { desiredTrad, desiredRoth, desiredTax, desiredEsop } = desired;

    let rmdTrad = 0, rmdEsop = 0;
    if (age >= rmdAge) {
      const divisor = rmdDivisor(age);
      rmdTrad = bal.traditional / divisor;
      rmdEsop = bal.esop / divisor;
    }
    const actualTrad = Math.min(bal.traditional, Math.max(desiredTrad, rmdTrad));
    const actualEsop = Math.min(bal.esop, Math.max(desiredEsop, rmdEsop));
    const extraFromRMD = (actualTrad - desiredTrad) + (actualEsop - desiredEsop);

    const ssIncome = age >= ssClaimAge ? ssAnnualReal : 0;

    const ordinaryWithdrawal = actualTrad + actualEsop;
    const taxableGain = desiredTax * gainFraction;
    const taxableSSAmt = taxableSocialSecurity(ssIncome, ordinaryWithdrawal + taxableGain, tt.ssThresholds);
    const ordinaryTaxableIncome = Math.max(0, ordinaryWithdrawal + taxableSSAmt - tt.stdDeduction);
    const ordinaryTax = progressiveTax(ordinaryTaxableIncome, tt.brackets);
    const capGainsTax = ltcgTax(ordinaryTaxableIncome, taxableGain, tt.ltcg);
    // State tax: Utah (this tool's default) has no preferential capital-gains rate,
    // so both the ordinary base and the taxable gain are taxed at the same flat rate.
    // Simplification: reuses the federal post-standard-deduction base rather than
    // modeling a separate state deduction/bracket structure.
    const stateTax = stateTaxRate * (ordinaryTaxableIncome + taxableGain);
    const totalTax = ordinaryTax + capGainsTax + stateTax;

    // Rental cash flow and the HSA-covered portion of healthcare are not run through
    // this tax engine: rental profit is often substantially sheltered by depreciation
    // in practice (not modeled here), and qualified HSA withdrawals are tax-free by
    // law -- see methodology.
    const grossIncome = actualTrad + desiredRoth + desiredTax + actualEsop + ssIncome + rentalIncomeReal;
    const afterTaxTotal = grossIncome - totalTax;
    const ordinaryEffRate = ordinaryTaxableIncome > 0 ? ordinaryTax / ordinaryTaxableIncome : 0;
    const extraAfterTax = extraFromRMD * (1 - ordinaryEffRate);
    // The portion of this year's withdrawal that went to cover the HSA-uncovered
    // healthcare gap was never available to spend on anything else, so -- like the
    // reinvested extra-from-RMD amount -- it's netted back out of spendable income.
    const spendableAfterTax = afterTaxTotal - extraAfterTax - healthcareShortfall;

    bal.traditional = Math.max(0, bal.traditional - actualTrad) * (1 + realReturn);
    bal.roth = Math.max(0, bal.roth - desiredRoth) * (1 + realReturn);
    bal.taxable = Math.max(0, bal.taxable - desiredTax + extraAfterTax) * (1 + realReturn);
    bal.esop = Math.max(0, bal.esop - actualEsop) * (1 + realEsopReturn);
    bal.hsa = Math.max(0, bal.hsa - hsaWithdrawal) * (1 + realReturn);

    rows.push({
      age, year: CONFIG.CURRENT_YEAR + (age - inputs.currentAge),
      ssIncome, rentalIncome: rentalIncomeReal, rmdTrad, rmdEsop, extraFromRMD,
      withdrawalTrad: actualTrad, withdrawalRoth: desiredRoth, withdrawalTaxable: desiredTax, withdrawalEsop: actualEsop,
      healthcareCost: healthcareCostReal, hsaWithdrawal, healthcareShortfall,
      grossIncome, totalTax, stateTax, afterTaxTotal, spendableAfterTax,
      balTraditional: bal.traditional, balRoth: bal.roth, balTaxable: bal.taxable, balEsop: bal.esop, balHsa: bal.hsa,
      balTotal: bal.traditional + bal.roth + bal.taxable + bal.esop + bal.hsa,
    });
  }

  return { rows, ssAnnualReal, targetSpendReal, swr, totalAtRetirementReal, rmdAge, rentalIncomeReal };
}

// Objective: total lifetime after-tax resources = money actually spent across
// retirement + whatever is left unspent at death (so reinvested RMD dollars are
// counted exactly once, not double-counted). Computed in real (today's) dollars,
// which is the natural unit for summing money received across many different years.
function lifetimeResourceObjective(sim) {
  const spent = sim.rows.reduce((s, r) => s + r.spendableAfterTax, 0);
  const legacy = sim.rows.length ? sim.rows[sim.rows.length - 1].balTotal : 0;
  return spent + legacy;
}

// Same objective, but each year's dollars are first inflated to the nominal amount
// that would actually appear in that future year before summing -- i.e. "total actual
// future dollars received over your lifetime," for display in nominal mode.
function nominalLifetimeResourceObjective(sim, currentAge, inflationRatePct) {
  const infl = inflationRatePct / 100;
  let total = 0;
  sim.rows.forEach(r => { total += r.spendableAfterTax * Math.pow(1 + infl, r.age - currentAge); });
  const last = sim.rows.length ? sim.rows[sim.rows.length - 1] : null;
  if (last) total += last.balTotal * Math.pow(1 + infl, last.age - currentAge);
  return total;
}

function recommendSSClaimAge(inputs, proj, ssBase) {
  const candidates = [62,63,64,65,66,67,68,69,70];
  const results = candidates.map(age => {
    const sim = simulateRetirement(inputs, age, proj, ssBase);
    return { claimAge: age, objective: lifetimeResourceObjective(sim), ssAnnualReal: sim.ssAnnualReal, sim };
  });
  let best = results[0];
  results.forEach(r => { if (r.objective > best.objective) best = r; });
  return { best: best.claimAge, results };
}

// ---- Post-death trust / legacy ----
function simulateTrust(startBalance, spendRatePct, growthRatePct, years) {
  years = years || 100;
  const r = growthRatePct / 100;
  const spendRate = spendRatePct / 100;
  const rows = [];
  let bal = Math.max(0, startBalance);
  for (let y = 0; y <= years; y++) {
    const distribution = bal * spendRate;
    if (y % 10 === 0) rows.push({ yearsAfterDeath: y, balance: bal, distribution });
    bal = Math.max(0, bal - distribution) * (1 + r);
  }
  return rows;
}

// ---- Top-level: accumulation snapshot + first retirement year + recommendation + trust ----
function computeResults(inputs) {
  const proj = projectBalances(inputs);
  const yearsToRetirement = inputs.retirementAge - inputs.currentAge;
  const inflFactor = Math.pow(1 + inputs.inflationRate / 100, yearsToRetirement);
  const finalTotal = proj.finalBalances.traditional + proj.finalBalances.roth + proj.finalBalances.taxable + proj.finalBalances.esop + (proj.finalBalances.hsa || 0);

  const nominalBalance = finalTotal;
  const realBalance = finalTotal / inflFactor;
  const mndBalance = finalTotal / (inflFactor * CONFIG.MND_CPI_FACTOR);

  const ssBase = computeSocialSecurityBase(inputs);
  const recommendation = recommendSSClaimAge(inputs, proj, ssBase);
  const ssClaimAge = inputs.ssClaimAge || recommendation.best;
  const sim = simulateRetirement(inputs, ssClaimAge, proj, ssBase);
  const firstYear = sim.rows[0];

  // The trust corpus (and everything upstream of it) is carried in today's real
  // dollars, so it grows at the REAL S&P 500 return (nominal minus inflation), not
  // the nominal rate -- otherwise it would silently mix nominal growth into a
  // real-dollar balance and wildly overstate it.
  const realReturnForTrust = ((1 + inputs.expectedReturn / 100) / (1 + inputs.inflationRate / 100) - 1) * 100;
  const trust = simulateTrust(sim.rows.length ? sim.rows[sim.rows.length-1].balTotal : 0, inputs.trustSpendRate, realReturnForTrust, 100);

  return {
    proj, yearsToRetirement, inflFactor,
    nominalBalance, realBalance, mndBalance,
    ssBase, ssClaimAge, recommendation,
    sim, firstYear,
    swr: sim.swr, grossWithdrawalReal: sim.targetSpendReal,
    trust,
  };
}

module.exports = {
  CONFIG, fraMonths, rmdStartAge, rmdDivisor, remainingLifeExpectancy, defaultDeathAge,
  taxTables, progressiveTax, ltcgTax, taxableSocialSecurity,
  electiveCapForAge, swrForAge, pIAFromAIME, adjustPIAForClaimAge,
  projectBalances, proxyEarningsHistory, computeSocialSecurityBase, ssAnnualForClaimAge,
  realEstateAnnualCashFlow, splitWithdrawal,
  simulateRetirement, lifetimeResourceObjective, nominalLifetimeResourceObjective, recommendSSClaimAge, simulateTrust,
  computeResults,
};
