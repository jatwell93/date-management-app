// The claim email body moved to `shared/domain/credit-claim-email.ts` so the Workers
// runtime renders byte-identical emails rather than carrying a second copy that can
// drift (see that module's header). This file stays as the backend's import site.
export {
  renderClaimEmail,
  type RenderedClaimEmail,
  type RenderableClaim,
  type RenderableClaimLine,
} from '../../../shared/domain/credit-claim-email';
