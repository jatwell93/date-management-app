import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { AddAreaForm } from '../components/store-areas/AddAreaForm';
import { AreasList } from '../components/store-areas/AreasList';
import { FloorProgressSection } from '../components/store-areas/FloorProgressSection';
import { useStoreAreaManagement } from '../hooks/useStoreAreaManagement';

interface StoreAreaManagementPageProps {
  token: string | null;
}

export function StoreAreaManagementPage({ token }: StoreAreaManagementPageProps) {
  const {
    view,
    dispatch,
    storeAreas,
    floorProgress,
    departmentOptions,
    isLoadingAreas,
    isLoadingProgress,
    isAddingArea,
    isEditingArea,
    isStartingCycle,
    isCompletingCycle,
    checkingBayId,
    deletingAreaId,
    handleAddArea,
    handleEditArea,
    handleDeleteArea,
    handleStartCycle,
    handleCompleteCycle,
    handleRecordBayCheck,
  } = useStoreAreaManagement(token);

  return (
    <section aria-labelledby="store-area-management-title" className="mx-auto w-full max-w-5xl">
      <Card className="mx-auto w-full">
        <CardHeader className="px-4 sm:px-6">
          <CardTitle
            id="store-area-management-title"
            role="heading"
            aria-level={1}
            className="text-left sm:text-center"
          >
            Store Area Management
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 sm:px-6">
          {view.error && (
            <p
              role="alert"
              className="text-semantic-critical-muted-foreground text-sm text-center mt-4"
            >
              Error: {view.error}
            </p>
          )}
          {view.successMessage && (
            <p
              role="status"
              className="text-semantic-success-muted-foreground text-sm text-center mt-4"
            >
              {view.successMessage}
            </p>
          )}

          <FloorProgressSection
            floorProgress={floorProgress}
            isLoadingProgress={isLoadingProgress}
            isCompletingCycle={isCompletingCycle}
            isStartingCycle={isStartingCycle}
            checkingBayId={checkingBayId}
            newCycleName={view.newCycleName}
            onNewCycleNameChange={(value) => dispatch({ type: 'SET_NEW_CYCLE_NAME', value })}
            onStartCycle={handleStartCycle}
            onCompleteCycle={handleCompleteCycle}
            onRecordBayCheck={handleRecordBayCheck}
          />

          <AddAreaForm
            newAreaName={view.newAreaName}
            newSubDepartmentName={view.newSubDepartmentName}
            newParentDepartmentId={view.newParentDepartmentId}
            invalidField={view.invalidField}
            departmentOptions={departmentOptions}
            isAddingArea={isAddingArea}
            onAreaNameChange={(value) => dispatch({ type: 'SET_NEW_AREA_NAME', value })}
            onSubDepartmentChange={(value) => dispatch({ type: 'SET_NEW_SUB_DEPARTMENT', value })}
            onParentChange={(value) => dispatch({ type: 'SET_NEW_PARENT', value })}
            onSubmit={handleAddArea}
          />

          <AreasList
            storeAreas={storeAreas}
            isLoadingAreas={isLoadingAreas}
            editingDialogKey={view.editingDialogKey}
            editedAreaName={view.editedAreaName}
            editedSubDepartmentName={view.editedSubDepartmentName}
            invalidField={view.invalidField}
            error={view.error}
            isEditingArea={isEditingArea}
            deleteDialogKey={view.deleteDialogKey}
            deletingAreaId={deletingAreaId}
            dispatch={dispatch}
            onSaveEdit={handleEditArea}
            onDelete={handleDeleteArea}
          />
        </CardContent>
      </Card>
    </section>
  );
}
