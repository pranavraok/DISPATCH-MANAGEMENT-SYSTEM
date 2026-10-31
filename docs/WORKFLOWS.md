# Two dispatch workflows

The same application, database and login serve both workflows. After signing in, choose **Pack before order** or **Order first**. The sidebar identifies the current workflow; **Switch workflow** returns to the choice. Refresh preserves the workflow and page in the URL. No second login or device pairing is required.

## Shared setup

Open **Shared settings** from either dashboard or the initial choice. Add the actual products and customers once. The same company-level Tally mapping and connector are returned in both workflows. Pair the Tally PC once when physical integration is ready.

The scanner uses the computer's existing HID/USB/receiver connection. Save a unique scanner workstation name in Shared settings on each computer. This browser setting is keyed by company, not workflow. Both paths use the same QR format, scanner component, speaker handling, A4 label PDF generator, packing PDF generator and browser printing. Select the actual printer through the browser/OS print dialog; the website does not silently install drivers or select an arbitrary printer.

## Pack before order

1. Open **Packing**, add the contents and carton counts as general stock, and obtain supervisor approval.
2. Open **Labels > Print & attach**, batch-print the labels, attach them to matching cartons, and confirm the physical labels and contents. Do not scan here.
3. When an order arrives, open **Orders**, record its customer, reference, destination and total carton requirement. Product totals are optional when only the carton count is known.
4. In **Trips**, create the vehicle trip, choose the order and reserve the exact labelled cartons. The existing quick customer-only reservation remains available in this workflow. Unselected cartons remain available.
5. Open **Labels > Scan for dispatch**, choose the shipment, enable the scanner/sound session and scan each physical carton once.
6. Review and approve the complete reserved load, then review billing. Real Tally posting remains gated by the integration boundary below.

## Order first

1. Open **Orders** and record the received customer order before packing.
2. Use **Pack this order**, or choose the order in a new packing list/import. The order supplies the customer and warehouse. General unassigned packing is not accepted in this workflow.
3. Record the actual contents, approve packing, batch-print and attach labels, and confirm the physical contents without scanning.
4. Create a vehicle trip and choose that exact order when reserving its cartons. Cartons for another order are rejected even if the customer is the same.
5. Perform the one dispatch scan per carton in **Labels > Scan for dispatch**, then approve loading and review billing.

## Counts, partial shipments and protection

An order reference is unique within its workflow and company. The total ordered carton count is 1 to 10,000. Multiple partial shipments can share an order, but active allocations cannot exceed its total. Order-first packing cannot exceed the order's carton count. When product requirements are provided, quantities are checked in validated base units; a full order's carton count must also match all specified product totals.

If only a carton count is recorded, the app cannot prove that the product mix matches an unrecorded customer requirement. Staff must review the recorded contents. A scan identifies the label and database snapshot, not sealed physical contents.

Workflow checks run on the server as well as in the UI. Lists, carton availability, trips, shipments, loading, billing, labels and operational history are filtered to the selected workflow. Products, customers, warehouses, users, Tally mapping and connectors are shared. Active carton allocations remain unique across the entire company. Uncertain scans block workflow switching and retain their original workflow in their recoverable request envelope.

Existing records are retained as Pack before order during migration. Existing printed carton codes remain valid. Deletion still requires the existing role, state, reason and confirmation rules; only unused customer orders can be deleted.

## Accounting and hardware acceptance

Packing, labelling, reserving and scanning do not manufacture or deduct Tally stock. Both workflows use the same accounting boundary. The current connector supports pairing and diagnostics; actual invoice creation, complete voucher/stock readback and confirmed invoice printing remain disabled until validated on the installed Tally test company. Do not interpret a draft bill or packing-list PDF as a tax invoice.

Actual scanner, speaker and printer checks are still required on the physical workstation. Switching workflows does not require reconnecting them.

## Automated verification

- `web/src/workflow.test.tsx`: initial choice, separate dashboards/orders, refresh, shared workstation settings, pending-scan switching guard and both packing entry paths.
- `tests/workflows.mjs`: real API/PostgreSQL checks covering both complete paths through billing review, one-scan loading, shared mappings/connectors/masters, cross-workflow and same-customer/different-order rejection, remaining stock, order limits, unused-order deletion and blocked real posting.
- The existing dispatch, grouping and single-scan suites remain applicable. Use only an isolated test database. See `docs/VALIDATION.md` for executed results.
