import { useCallback } from 'react';
import type { Project, ProjectFile } from '../../types';
import { fetchProjects, createProject, deleteProject, fetchProjectFiles } from '../../utils/api';

export interface ProjectsSliceDeps {
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  setActiveProject: React.Dispatch<React.SetStateAction<Project | null>>;
  setProjectFiles: React.Dispatch<React.SetStateAction<ProjectFile[]>>;
  setIsProjectsPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useProjectsSlice({
  setProjects,
  setActiveProject,
  setProjectFiles,
  setIsProjectsPanelOpen,
}: ProjectsSliceDeps) {
  const refreshProjects = useCallback(async () => {
    const list = await fetchProjects();
    setProjects(list);
    return list;
  }, [setProjects]);

  const createNewProject = useCallback(async (name: string, description: string) => {
    const project = await createProject(name, description);
    if (project) {
      await refreshProjects();
      setActiveProject(project);
    }
    return project;
  }, [refreshProjects, setActiveProject]);

  const removeProject = useCallback(async (id: string) => {
    const ok = await deleteProject(id);
    if (ok) {
      await refreshProjects();
      setActiveProject((prev) => (prev?.id === id ? null : prev));
    }
    return ok;
  }, [refreshProjects, setActiveProject]);

  const openProject = useCallback(async (project: Project) => {
    setActiveProject(project);
    const files = await fetchProjectFiles(project.id);
    setProjectFiles(files);
  }, [setActiveProject, setProjectFiles]);

  const closeProject = useCallback(() => {
    setActiveProject(null);
    setProjectFiles([]);
  }, [setActiveProject, setProjectFiles]);

  const refreshProjectFiles = useCallback(async (projectId: string) => {
    const files = await fetchProjectFiles(projectId);
    setProjectFiles(files);
    return files;
  }, [setProjectFiles]);

  const openProjectsPanel = useCallback(() => setIsProjectsPanelOpen(true), [setIsProjectsPanelOpen]);
  const closeProjectsPanel = useCallback(() => setIsProjectsPanelOpen(false), [setIsProjectsPanelOpen]);

  return {
    refreshProjects,
    createNewProject,
    removeProject,
    openProject,
    closeProject,
    refreshProjectFiles,
    openProjectsPanel,
    closeProjectsPanel,
  };
}
