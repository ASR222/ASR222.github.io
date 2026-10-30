import { getCollection, type CollectionEntry } from 'astro:content';
import { projects } from './site';

export type Post = CollectionEntry<'writing'>;

export const kinds = {
  journey: 'Journey and learnings',
  technical: 'Technical',
} as const;

export async function getPosts(): Promise<Post[]> {
  const posts = await getCollection('writing', (p) => import.meta.env.DEV || !p.data.draft);
  return posts.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

export function readingTime(post: Post): string {
  const words = (post.body ?? '').split(/\s+/).filter(Boolean).length;
  return `${Math.max(1, Math.round(words / 220))} min read`;
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}


type Pic = { src: string; alt: string; width: number; height: number; position?: string };

// Pictures for the writing pages: the campus and the screens of the work.
export const workPics: Pic[] = [
  { src: '/img/campus-trees.jpg', alt: 'Morning light through the trees on the BIT Mesra campus', width: 1056, height: 592, position: '35% 50%' },
  { src: '/img/cortexai.jpg', alt: 'CortexAI routing a request to its coding agent', width: 1200, height: 750, position: '30% 50%' },
  { src: '/img/memledger.jpg', alt: 'MemLedger answering why the team believes a root cause', width: 1200, height: 750, position: '58% 50%' },
  { src: '/img/hazebusters.jpg', alt: 'HazeBusters architecture on AWS', width: 1200, height: 750, position: '62% 50%' },
];

// The pictures beside a post: the screens of its project, or the work in general.
export function picsFor(post: Post): Pic[] {
  const project = projects.find((p) => p.slug === post.data.project);
  if (!project) return workPics;
  return [project.shot, ...project.stage.filter((s): s is Pic & { caption?: string } => 'src' in s)];
}
