const { isCp2Meter } = require("./cp2Service");
const { isCp2nusMeter } = require("./cp2nusService");

const CP2NUS_ON_CP2_ERROR =
  "This meter belongs to the CP2NUS system and cannot be topped up here. " +
  "Please use the UTown Residence / RVRC / Valour House option instead.";

function createCp2SystemGuard({
  cp2MeterCheck = isCp2Meter,
  cp2nusMeterCheck = isCp2nusMeter,
  logger = console,
} = {}) {
  return async function guardCp2PaymentSystem({ txtMtrId, txtAmount } = {}) {
    let cp2Check;

    try {
      cp2Check = await cp2MeterCheck(txtMtrId);
    } catch (err) {
      logger.warn?.(
        "[cp2_meter_system_check] CP2 check failed, proceeding:",
        err.message,
      );
      return { ok: true, skipped: true, reason: "cp2_check_failed" };
    }

    if (cp2Check?.ok) {
      return { ok: true, cp2Check };
    }

    if (cp2Check?.result && cp2Check.result !== "invalid") {
      return {
        ok: true,
        skipped: true,
        reason: `cp2_check_${cp2Check.result}`,
        cp2Check,
      };
    }

    let cp2nusCheck;

    try {
      cp2nusCheck = await cp2nusMeterCheck(txtMtrId, txtAmount);
    } catch (err) {
      logger.warn?.(
        "[cp2_meter_system_check] CP2NUS check failed, proceeding:",
        err.message,
      );
      return {
        ok: true,
        skipped: true,
        reason: "cp2nus_check_failed",
        cp2Check,
      };
    }

    if (cp2nusCheck?.ok) {
      return {
        ok: false,
        code: "WRONG_SYSTEM",
        stage: "meter_system_check",
        error: CP2NUS_ON_CP2_ERROR,
        cp2Check,
        cp2nusCheck,
      };
    }

    return { ok: true, cp2Check, cp2nusCheck };
  };
}

const guardCp2PaymentSystem = createCp2SystemGuard();

module.exports = {
  CP2NUS_ON_CP2_ERROR,
  createCp2SystemGuard,
  guardCp2PaymentSystem,
};
