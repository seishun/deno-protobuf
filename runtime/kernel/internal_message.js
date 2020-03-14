/**
 * @fileoverview Internal interface for messages implemented with the binary
 * kernel.
 */

import Kernel from "./kernel.js";

/**
 * Interface that needs to be implemented by messages implemented with the
 * binary kernel. This is an internal only interface and should be used only by
 * the classes in binary kernel.
 *
 * @interface
 */
class InternalMessage {
  /**
   * @package
   * @return {!Kernel}
   */
  internalGetKernel() {}
}

export default InternalMessage;