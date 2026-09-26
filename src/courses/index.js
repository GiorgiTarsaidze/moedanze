// Course registry. Add further Georgian examination grounds (Tbilisi, Gori, Kutaisi, Batumi …)
// by creating src/courses/<id>/course.js with the same data shape as the Rustavi course.
import { rustaviCourse } from './rustavi/course.js';

export const courses = { rustavi: rustaviCourse };
export const defaultCourse = 'rustavi';
